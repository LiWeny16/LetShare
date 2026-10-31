import ReactDOM from "react-dom/client"
import Index from "./pages/index.tsx"
import "./style/overlay-scrollbar.css"
import "./style/selection.css"
import { installOverlayScrollbars } from "./app/libs/ui/overlayScrollbars"
import { installSelectionTheme } from "./app/libs/ui/selectionTheme"

const disposeScrollbars = installOverlayScrollbars()
const disposeSelectionTheme = installSelectionTheme()
if (import.meta.hot) import.meta.hot.dispose(() => { disposeScrollbars(); disposeSelectionTheme() })

ReactDOM.createRoot(document.getElementById("root")!).render(
  // <React.StrictMode>
  <Index />
  // </React.StrictMode>
)
