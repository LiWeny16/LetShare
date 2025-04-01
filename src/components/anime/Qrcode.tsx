// import React, { useEffect, useRef, useState } from 'react';
// import QRCodeGen from 'qrcode-generator';
// import anime from 'animejs';

// interface FancyQRCodeProps {
//   text: string;
//   size?: number;
// }

// interface QRDot {
//   x: number;
//   y: number;
//   isDark: boolean;
// }

// const FancyQRCode: React.FC<FancyQRCodeProps> = ({ text, size = 320 }) => {
//   const [dots, setDots] = useState<QRDot[]>([]);
//   const dotCount = 33;
//   const dotSize = size / dotCount;
//   const circleRefs = useRef<SVGCircleElement[]>([]);

//   // 初始化二维码矩阵
//   useEffect(() => {
//     const qr = QRCodeGen(0, 'H');
//     qr.addData(text);
//     qr.make();
//     const moduleCount = qr.getModuleCount();

//     const newDots: QRDot[] = [];
//     for (let row = 0; row < moduleCount; row++) {
//       for (let col = 0; col < moduleCount; col++) {
//         if (qr.isDark(row, col)) {
//           newDots.push({ x: col, y: row, isDark: true });
//         }
//       }
//     }

//     setDots(newDots);
//   }, [text]);

//   // 飞入动画，仅执行一次
//   useEffect(() => {
//     if (circleRefs.current.length === 0) return;

//     const originX = size; // 飞入起点 X（右下角）
//     const originY = size;

//     circleRefs.current.forEach((el, i) => {
//       if (!el) return;

//       const delay = i * (5000 / circleRefs.current.length); // 总动画控制在 5s 内

//       anime({
//         targets: el,
//         cx: el.getAttribute('cx'),
//         cy: el.getAttribute('cy'),
//         opacity: [0, 1],
//         translateX: [originX - Number(el.getAttribute('cx')), 0],
//         translateY: [originY - Number(el.getAttribute('cy')), 0],
//         easing: 'easeOutExpo',
//         duration: 1000,
//         delay,
//       });
//     });
//   }, [dots, size]);

//   return (
//     <svg
//       width={size}
//       height={size}
//       viewBox={`0 0 ${size} ${size}`}
//       style={{
//         background: '#fff',
//         borderRadius: '16px',
//         display: 'block',
//         boxShadow: '0 0 20px rgba(0, 0, 0, 0.05)',
//       }}
//     >
//       {dots.map((dot, i) => {
//         const cx = dot.x * dotSize + dotSize / 2;
//         const cy = dot.y * dotSize + dotSize / 2;

//         return (
//           <circle
//             key={i}
//             ref={(el) => (circleRefs.current[i] = el!)}
//             cx={cx}
//             cy={cy}
//             r={dotSize * 0.45}
//             fill="#555"
//             opacity={0}
//             style={{
//               transition: 'r 0.2s',
//               filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1))',
//             }}
//           />
//         );
//       })}
//     </svg>
//   );
// };

// export default FancyQRCode;
