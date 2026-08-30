import "../style/index.css"

import { lazy, Suspense } from "react"
import { HashRouter, Navigate, Route, Routes } from "react-router-dom"

// 首屏拆分：主页面（Share）与支付页（PayNow）体积大（MUI 全量 + 业务逻辑），
// 改为懒加载，首屏只加载轻量路由壳，减少新设备第一次访问的下载量与超时。
const Share = lazy(() => import("../pages/share"))
const PayNowComponent = lazy(() => import("./paynow"))

function FullScreenFallback() {
 return (
  <div
   style={{
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, sans-serif",
    color: "#888",
    fontSize: "15px",
   }}
  >
    Loading…
  </div>
 )
}

export default function Index() {
 return (
  <HashRouter>
   <Routes>
    <Route
     path="/"
     element={
      <Suspense fallback={<FullScreenFallback />}>
       <Share />
      </Suspense>
     }
    />
    <Route
     path="/paynow"
     element={
      <Suspense fallback={<FullScreenFallback />}>
       <PayNowComponent />
      </Suspense>
     }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
   </Routes>
  </HashRouter>
 )
}
