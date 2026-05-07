/*
    _   _      _    ___      _       _     _
   | \ | | ___| |_ / __| ___| |_ ___| |__ (_)
   |  \| |/ _ \ __| (_  / _ \ __/ __| '_ \| |
   | |\  |  __/ |_ \__ \ (_) | || (__| | | | |
   |_| \_|\___|\__|___/\___/ \__\___|_| |_|_|

   netgotchi :: raw socket capture daemon
   author  : netgotchi project
   target  : linux (AF_PACKET requires kernel >= 2.2)
   perms   : CAP_NET_RAW only -- not --privileged. principle of least privilege.

   Note: classic userland raw socket implementation.
   Porting to eBPF/XDP later to bypass the kernel TCP/IP stack entirely
   and eliminate recvfrom() syscall overhead above ~100k pps.
*/

#include <iostream>
#include <sstream>
#include <string>
#include <cstring>
#include <ctime>
#include <csignal>
#include <atomic>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <linux/if_ether.h>
#include <netinet/ip.h>
#include <netinet/tcp.h>
#include <netinet/udp.h>
#include <netinet/ip_icmp.h>

// Graceful shutdown flag. Signal handler sets this; main loop checks it.
// atomic_bool avoids the data race that a plain bool would introduce
// when the signal fires on a different kernel thread.
static std::atomic<bool> g_running(true);

static void signal_handler(int sig) {
    (void)sig;
    g_running.store(false);
}

// Escape a string for safe JSON embedding.
// inet_ntoa output is clean, but defensive coding here costs nothing.
static std::string json_escape(const std::string& s) {
    std::ostringstream out;
    for (unsigned char c : s) {
        if (c == '"')  out << "\\\"";
        else if (c == '\\') out << "\\\\";
        else out << c;
    }
    return out.str();
}

// ISO-8601 UTC timestamp. Keeps frontend and backend timestamps in sync --
// trusting client-side Date() introduces skew across timezones.
static std::string utc_timestamp() {
    time_t now = time(nullptr);
    struct tm *t = gmtime(&now);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", t);
    return std::string(buf);
}

int main() {
    // Register signal handlers before doing anything privileged.
    // SIGTERM is what Docker sends on `docker-compose down`.
    signal(SIGTERM, signal_handler);
    signal(SIGINT,  signal_handler);

    // AF_PACKET + SOCK_RAW captures at layer 2. ETH_P_ALL catches every
    // ethertype. Requires CAP_NET_RAW -- not full --privileged.
    int raw_fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (raw_fd < 0) {
        // Emit a JSON error so the Python broker can parse it like any other
        // line instead of reading a bare error string and choking.
        std::cerr << "{\"error\":\"socket() failed -- missing CAP_NET_RAW?\"}" << std::endl;
        return 1;
    }

    // Stack-allocated 64KB frame buffer. Max Ethernet payload is ~1500B,
    // but jumbo frames go up to 9000B. 65535 is the safe ceiling.
    unsigned char buffer[65535];
    memset(buffer, 0, sizeof(buffer));

    while (g_running.load()) {
        ssize_t frame_len = recvfrom(raw_fd, buffer, sizeof(buffer), 0, nullptr, nullptr);
        if (frame_len < 0) continue;
        if (frame_len < (ssize_t)sizeof(struct ethhdr)) continue;

        struct ethhdr *eth = reinterpret_cast<struct ethhdr*>(buffer);

        // Only care about IPv4 for the MVP. ARP, IPv6, etc. filtered here
        // rather than with a BPF kernel filter to keep the build dependency-free.
        if (ntohs(eth->h_proto) != ETH_P_IP) continue;

        // Bounds check: ensure the IP header fits within the captured frame
        if (frame_len < (ssize_t)(sizeof(struct ethhdr) + sizeof(struct iphdr))) continue;

        struct iphdr *iph = reinterpret_cast<struct iphdr*>(buffer + sizeof(struct ethhdr));

        // ihl is the IP header length in 32-bit words. Valid range: 5-15.
        // Anything outside that range means a malformed or crafted packet -- skip.
        if (iph->ihl < 5 || iph->ihl > 15) continue;

        int iphdrlen = iph->ihl * 4;

        // inet_ntoa uses a static internal buffer -- copy to std::string immediately
        // before any subsequent call overwrites it.
        struct in_addr src_addr, dst_addr;
        src_addr.s_addr = iph->saddr;
        dst_addr.s_addr = iph->daddr;
        std::string src_ip = json_escape(inet_ntoa(src_addr));
        std::string dst_ip = json_escape(inet_ntoa(dst_addr));

        std::string proto  = "UNKNOWN";
        int src_port = 0;
        int dst_port = 0;

        if (iph->protocol == IPPROTO_TCP) {
            size_t tcp_offset = sizeof(struct ethhdr) + iphdrlen;
            if (frame_len >= (ssize_t)(tcp_offset + sizeof(struct tcphdr))) {
                struct tcphdr *tcph = reinterpret_cast<struct tcphdr*>(buffer + tcp_offset);
                proto    = "TCP";
                src_port = ntohs(tcph->source);
                dst_port = ntohs(tcph->dest);
            }
        } else if (iph->protocol == IPPROTO_UDP) {
            size_t udp_offset = sizeof(struct ethhdr) + iphdrlen;
            if (frame_len >= (ssize_t)(udp_offset + sizeof(struct udphdr))) {
                struct udphdr *udph = reinterpret_cast<struct udphdr*>(buffer + udp_offset);
                proto    = "UDP";
                src_port = ntohs(udph->source);
                dst_port = ntohs(udph->dest);
            }
        } else if (iph->protocol == IPPROTO_ICMP) {
            proto = "ICMP";
            // No ports for ICMP. src/dst stay 0 -- frontend handles gracefully.
        }

        // Hand-rolled JSON is fragile in general, but the only dynamic strings
        // here are inet_ntoa outputs (dotted decimal -- no injection surface)
        // and the json_escape'd protocol name (a compile-time constant set).
        // Using a full JSON library would be overkill for this output format.
        std::cout << "{"
                  << "\"ts\":\"" << utc_timestamp() << "\","
                  << "\"src_ip\":\"" << src_ip << "\","
                  << "\"src_port\":" << src_port << ","
                  << "\"dst_ip\":\"" << dst_ip << "\","
                  << "\"dst_port\":" << dst_port << ","
                  << "\"protocol\":\"" << proto << "\","
                  << "\"size\":" << frame_len
                  << "}" << std::endl;
        // std::endl flushes stdout. Critical for the async pipe --
        // without flush, the Python broker starves waiting for newlines.
    }

    close(raw_fd);
    // Clean exit emits a final sentinel line the broker can detect
    std::cerr << "{\"info\":\"sniffer shutting down cleanly\"}" << std::endl;
    return 0;
}