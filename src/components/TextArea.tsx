import React from "react"

const MyComponent = React.forwardRef((props: any, ref: any) => {
  return (
    <textarea
      ref={ref}
      aria-label="textarea"
      placeholder="Enter your text"
      style={{
        width: "100%",
        minHeight: "100px",
        padding: "10px",
        margin: "5px",
        fontSize: "16px",
        borderRadius: "8px", // 圆角
        border: "1px solid #ccc", // 边框
        outline: "none", // 去除默认的轮廓线
        resize: "none", // 禁止调整大小
        fontFamily: "inherit", // 继承父级字体
        backgroundColor: "#f5f5f5", // 背景色
        transition: "border-color 0.2s ease", // 过渡效果
        "&:focus": {
          borderColor: "#4CAF50", // Border color on focus
        },
      }} // 样式调整例子
      {...props}
    />
  )
})

export default MyComponent
