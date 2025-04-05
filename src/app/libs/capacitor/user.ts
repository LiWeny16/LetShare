import { Capacitor } from "@capacitor/core"

const isApp = Capacitor.isNativePlatform()
export { isApp }