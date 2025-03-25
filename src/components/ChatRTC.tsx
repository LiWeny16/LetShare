import React, { useEffect, useRef } from "react"
import TextArea from "./TextArea"
import { Box } from "@mui/material"
const WebRTCComponent: React.FC = () => {
  const localTextRef = useRef<HTMLTextAreaElement>(null)
  const remoteTextRef = useRef<HTMLTextAreaElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket("wss://webrtc-wabmmfcxmo.cn-shanghai.fcapp.run")
    // const ws = new WebSocket("ws://127.0.0.1:9000")
    socketRef.current = ws

    const createPeerConnection = async () => {
      const peerConnection = new RTCPeerConnection()
      peerConnectionRef.current = peerConnection

      // 监听 ice 候选项事件
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(
            JSON.stringify({
              type: "iceCandidate",
              candidate: event.candidate,
            })
          )
        }
      }

      // 监听获取远程数据通道
      peerConnection.ondatachannel = (event) => {
        const dataChannel = event.channel
        dataChannel.onmessage = (event) => {
          if (remoteTextRef.current) {
            remoteTextRef.current.value = event.data + "\n"
          }
        }
      }

      ws.onmessage = async (event) => {
        const reader = new FileReader()
        reader.readAsText(event.data, "utf-8")
        reader.onload = async () => {
          const data = JSON.parse(reader.result as string) // 从 FileReader 中提取实际消息内容并解析为 JSON
          console.log(data)

          if (data.type === "offer") {
            await peerConnection.setRemoteDescription(data.offer)
            const answer = await peerConnection.createAnswer()
            await peerConnection.setLocalDescription(answer)
            ws.send(JSON.stringify({ type: "answer", answer }))
          } else if (data.type === "answer") {
            await peerConnection.setRemoteDescription(data.answer)
          } else if (data.type === "iceCandidate") {
            await peerConnection.addIceCandidate(data.candidate)
          }
        }
      }
    }

    const startCall = async () => {
      console.log("startCalls")

      const peerConnection = peerConnectionRef.current
      if (peerConnection) {
        const dataChannel = peerConnection.createDataChannel("messageChannel")
        dataChannel.onopen = () => {
          if (localTextRef.current) {
            localTextRef.current.addEventListener("input", (event) => {
              const target = event.target as HTMLTextAreaElement
              dataChannel.send(target.value)
            })
          }
        }
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        ws.send(JSON.stringify({ type: "offer", offer }))
      }
    }

    const main = async () => {
      await createPeerConnection()
      ws.onopen = startCall
    }

    main()

    return () => {
      ws.close()
    }
  }, [])

  return (
    <Box
      sx={{
        width: "65svw",
        height: "80svh",
        display: "flex",
        justifyContent:"space-around",
        flexDirection: "row",
      }}
    >
      <TextArea ref={localTextRef} placeholder="Local text" />
      <TextArea ref={remoteTextRef} placeholder="Remote text" readOnly />
    </Box>
  )
}

export default WebRTCComponent
