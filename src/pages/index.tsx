import "../style/index.css"

import { lazy, Suspense } from "react"
import { HashRouter, Navigate, Route, Routes } from "react-router-dom"
import { initializeIdentity } from "@App/libs/identity/identity"

// 首屏拆分：主页面（Share）与支付页（PayNow）体积大（MUI 全量 + 业务逻辑），
// 改为懒加载，首屏只加载轻量路由壳，减少新设备第一次访问的下载量与超时。
const Share = lazy(() => import("../pages/share"))
const PayNowComponent = lazy(() => import("./paynow"))
const MeetingPage = lazy(() => import("./meeting"))

// 所有路由共享同一个应用身份初始化；路由只决定业务域，不决定身份生命周期。
initializeIdentity()

export default function Index() {
 return (
  <HashRouter>
   <Routes>
    <Route
     path="/"
     element={
      // fallback={null}：懒加载 chunk 下载期间 root 保持无子节点，
      // index.html 的 #app-loading 骨架屏得以延续显示（不出现第二层 Loading…），
      // 真实页面挂载后骨架屏由 MutationObserver 统一隐藏。
      <Suspense fallback={null}>
       <Share />
      </Suspense>
     }
    />
    <Route
     path="/paynow"
     element={
      <Suspense fallback={null}>
       <PayNowComponent />
      </Suspense>
     }
    />
    <Route
     path="/meeting"
     element={
      <Suspense fallback={null}>
       <MeetingPage />
      </Suspense>
     }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
   </Routes>
  </HashRouter>
 )
}
