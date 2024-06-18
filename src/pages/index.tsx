import "../style/index.css" // 导入你的CSS文件

import Home from "./home"
import Chat from "../pages/chat"
import { HashRouter, Routes, Route } from "react-router-dom" // 导入正确的组件和函数

export default function Index() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </HashRouter>
  )
}
