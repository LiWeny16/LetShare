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
    // 原样复刻 app 的中继式编排时序（offerer=calleeAddFirst 顺序 + 异步间隔 + 候选缓冲/flush）
    B.addTrack(bAud);
    var offer3 = await A.createOffer(); await A.setLocalDescription(offer3);
    await new Promise(function (r) { setTimeout(r, 40); });          // 信令中继延迟
    await B.setRemoteDescription(offer3);
    await new Promise(function (r) { setTimeout(r, 40); });
    var ans3 = await B.createAnswer(); await B.setLocalDescription(ans3);
    await new Promise(function (r) { setTimeout(r, 40); });
    await A.setRemoteDescription(ans3);
    await new Promise(function (r) { setTimeout(r, 40); });
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
