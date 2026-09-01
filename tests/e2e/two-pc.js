// 纯浏览器脚本（不经 tsx/esbuild 转译，有名字函数在此安全）。
// 同一页面内两个裸 RTCPeerConnection 直连，对比 callee 的 addTrack 顺序。
window.__runTwoPc = async function (ord) {
  function makePc() { return new RTCPeerConnection({ iceServers: [] }); }
  var A = makePc(), B = makePc();
  function attach(pc) {
    pc.ontrack = function (ev) {
      var s = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
      var el = document.createElement("audio"); el.autoplay = true; el.muted = false; el.srcObject = s;
      el.play().catch(function () {});
      document.body.appendChild(el);
    };
  }
  attach(A); attach(B);
  A.onicecandidate = function (e) { if (e.candidate) B.addIceCandidate(e.candidate).catch(function () {}); };
  B.onicecandidate = function (e) { if (e.candidate) A.addIceCandidate(e.candidate).catch(function () {}); };
  var aAud = (await navigator.mediaDevices.getUserMedia({ audio: true, video: false })).getAudioTracks()[0];
  var bAud = (await navigator.mediaDevices.getUserMedia({ audio: true, video: false })).getAudioTracks()[0];
  A.addTrack(aAud);
  if (ord === "calleeAddLast") {
    var offer1 = await A.createOffer(); await A.setLocalDescription(offer1);
    await B.setRemoteDescription(offer1);
    B.addTrack(bAud);
    var ans1 = await B.createAnswer(); await B.setLocalDescription(ans1);
    await A.setRemoteDescription(ans1);
  } else if (ord === "relayed") {
    // 忠实复刻 app 的中继编排：双端在 remoteDescription 就绪前缓冲 ICE(pendingIce)，
    // 信令经 setTimeout 模拟中继延迟。这在之前的极简模型里缺失(候选在远端未就绪时被丢)，
    // 导致 ICE 连不上。这里补上缓冲，看能否复现 app 的 disc≈600。
    B.addTrack(bAud);
    B.__ic = [];
    A.__ic = [];
    A.onicecandidate = function (e) { if (e.candidate) B.__ic.push(e.candidate); }; // A 的候选入 B 缓冲
    B.onicecandidate = function (e) { if (e.candidate) A.__ic.push(e.candidate); }; // B 的候选入 A 缓冲
    var offerR = await A.createOffer(); await A.setLocalDescription(offerR);
    await new Promise(function (r) { setTimeout(r, 60); });          // 中继: offer 到达 B
    await B.setRemoteDescription(offerR);
    await new Promise(function (r) { setTimeout(r, 60); });
    var ansR = await B.createAnswer(); await B.setLocalDescription(ansR);
    // flush B 已收的 A 候选(此时 B.remoteDescription 就绪)
    for (var j = 0; j < B.__ic.length; j++) B.addIceCandidate(B.__ic[j]).catch(function () {});
    B.__ic = [];
    await new Promise(function (r) { setTimeout(r, 60); });          // 中继: answer 到达 A
    await A.setRemoteDescription(ansR);
    // flush A 已收的 B 候选
    for (var k = 0; k < A.__ic.length; k++) A.addIceCandidate(A.__ic[k]).catch(function () {});
    A.__ic = [];
    await new Promise(function (r) { setTimeout(r, 60); });
  } else {
    B.addTrack(bAud); // calleeAddFirst：app 现状 —— 先挂发送轨，再应用 offer
    var offer2 = await A.createOffer(); await A.setLocalDescription(offer2);
    await B.setRemoteDescription(offer2);
    var ans2 = await B.createAnswer(); await B.setLocalDescription(ans2);
    await A.setRemoteDescription(ans2);
  }
  await new Promise(function (res) {
    var t0 = Date.now();
    var iv = setInterval(function () {
      var ok = (A.iceConnectionState === "connected" || A.iceConnectionState === "completed") && Date.now() - t0 > 2000;
      if (ok || Date.now() - t0 > 15000) { clearInterval(iv); res(); }
    }, 200);
  });
  await new Promise(function (r) { setTimeout(r, 6000); });
  async function snap(pc) {
    var st = await pc.getStats(); var o = {};
    for (var it = st.values(), q; (q = it.next().value);) {
      if (q.type === "inbound-rtp" && q.kind === "audio") o.aIn = { ssrc: q.ssrc, smpl: q.totalSamplesReceived, disc: q.packetsDiscarded, pkt: q.packetsReceived, jb: q.jitterBufferDelay, conce: q.concealedSamples };
      if (q.type === "outbound-rtp" && q.kind === "audio") o.aOut = { ssrc: q.ssrc, smpl: q.totalSamplesSent, pkt: q.packetsSent, byes: q.bytesSent };
      if (q.type === "media-source" || q.type === "audio-source") o.mSrc = { lvl: q.audioLevel || 0, E: q.totalAudioEnergy || 0 };
    }
    return o;
  }
  return { A: await snap(A), B: await snap(B), iceA: A.iceConnectionState, iceB: B.iceConnectionState };
};
