import "../style/index.css" // 导入你的CSS文件

import Home from "./home"
import Chat from "../pages/chat"
import { BrowserRouter, Routes, Route } from "react-router-dom" // 导入正确的组件和函数

export default function Index() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  )
}
