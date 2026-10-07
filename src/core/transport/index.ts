// core/transport 对外只暴露一个入口面：调用方不得绕过 RetrySupervisor 自行排重试（P1）。
export * from "./RetrySupervisor";
export * from "./ConnectionState";
export * from "./attemptRun";
export * from "./SessionEpoch";
export * from "./LivenessMonitor";
export * from "./ServerLiveness";
export * from "./livenessProbe";
export * from "./ReconnectController";
export * from "./BackgroundPolicy";
// systemClock 是注入边界（唯一允许直连 Date.now/setTimeout/Math.random 的文件），
// 只导出实例，不导出实现类，防止有人绕过 Clock/Rng 注入。
export { systemClock, systemRng } from "./systemClock";
