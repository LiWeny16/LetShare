// GridLayout.tsx
import React from "react"
import Card from "../components/Card"

const displayContents = [
  {
    imgUrl: "https://bigonion.cn/background/packImg/1.jfif",
    url: "/chat",
    title: "文字共享",
    content:
      "这是一个基于WebRTC技术的共享文本在线APP，只需要连接两个同样的WIFI即可传输文本信息",
  },
  {
    imgUrl: "https://bigonion.cn/background/packImg/1.jfif",
    url: "/chat",
    title: "文字共享",
    content:
      "这是一个基于WebRTC技术的共享文本在线APP，只需要连接两个同样的WIFI即可传输文本信息",
  },
  {
    imgUrl: "https://bigonion.cn/background/packImg/1.jfif",
    url: "/chat",
    title: "文字共享",
    content:
      "这是一个基于WebRTC技术的共享文本在线APP，只需要连接两个同样的WIFI即可传输文本信息",
  },
]
const GridLayout: React.FC = () => {
  return (
    <div className="apps">
      <div className="grid-container">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="grid-item" key={index}>
            <Card
              url={displayContents[index].url}
              imageURL={displayContents[index].imgUrl}
              title={displayContents[index].title}
              content={displayContents[index].content}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default GridLayout
