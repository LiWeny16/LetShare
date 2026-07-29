import "../style/index.css"

import Share from "../pages/share"
import PayNowComponent from "./paynow"
import { HashRouter, Navigate, Route, Routes } from "react-router-dom"

export default function Index() {
 return (
  <HashRouter>
   <Routes>
    <Route path="/" element={<Share />} />
    <Route path="/paynow" element={<PayNowComponent />} />
    <Route path="*" element={<Navigate to="/" replace />} />
   </Routes>
  </HashRouter>
 )
}
