import "../style/index.css" // 导入你的CSS文件

// import Home from "./home"
// import Chat from "../pages/chat"
import Share from "../pages/share"
import { HashRouter, Routes, Route } from "react-router-dom" // 导入正确的组件和函数
import PayNowComponent from "./paynow"

export default function Index() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Share open={true} />} />
        {/* <Route path="/i" element={<Home />} /> */}
        {/* <Route path="/chat" element={<Chat />} /> */}
        <Route path="/paynow" element={<PayNowComponent />}></Route>
      </Routes>
    </HashRouter>
  )
}
