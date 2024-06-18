import "../style/index.css"
import Home from "./home"
import Chat from "../pages/chat"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/chat",
    element: <Chat />,
  },
])
export default function index() {
  return (
    <>
      <RouterProvider router={router} />
    </>
  )
}
