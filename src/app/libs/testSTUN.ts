async function testSTUNServers(stunServers: any) {
    for (const stunServer of stunServers) {
        try {
            console.log(`Testing STUN server: ${stunServer}`);
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: `stun:${stunServer}` }]
            });

            const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)); // 5s 超时
            const testPromise = new Promise((resolve) => {
                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        const candidate = event.candidate.candidate;
                        if (candidate.includes("srflx")) {
                            resolve(`✅ STUN ${stunServer} is WORKING. Public IP: ${candidate.split(" ")[4]}`);
                        }
                    }
                };

                pc.createDataChannel("test");
                pc.createOffer()
                    .then((offer) => pc.setLocalDescription(offer))
                    .catch(() => resolve(`❌ STUN ${stunServer} FAILED (offer error)`));
            });

            const result = await Promise.race([testPromise, timeout]);
            console.log(result);
            pc.close();
        } catch (error) {
            console.log(`❌ STUN ${stunServer} ERROR:`, error);
        }
    }
}

// 测试 STUN 服务器列表
const stunList = [
    "sip1.lakedestiny.cordiaip.com",
];

