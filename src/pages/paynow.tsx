import React, { useState, useEffect } from "react"
import { Box, Container, TextField, MenuItem, Button } from "@mui/material"
import { QRCode } from "react-qrcode-logo"
import paynowImg from "../assets/paynow.png" // Path to the PayNow logo image.
import { generatePayNowStr } from "../app/paynow" // Assuming you have the generatePayNowStr utility.
import "../style/paynow.css"
const PayNowComponent: React.FC = () => {
  // Load initial state from localStorage or use default values
  const [countryCode, setCountryCode] = useState(
    localStorage.getItem("countryCode") || "+65"
  ) // Default to Singapore
  const [phoneNumber, setPhoneNumber] = useState(
    localStorage.getItem("phoneNumber") || ""
  )
  const [payNowName, setPayNowName] = useState(
    localStorage.getItem("payNowName") || ""
  )

  useEffect(() => {
    // Store values in localStorage whenever they change
    localStorage.setItem("countryCode", countryCode)
  }, [countryCode])

  useEffect(() => {
    localStorage.setItem("phoneNumber", phoneNumber)
  }, [phoneNumber])

  useEffect(() => {
    localStorage.setItem("payNowName", payNowName)
  }, [payNowName])

  const handleCountryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCountryCode(event.target.value)
  }

  const handlePhoneNumberChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setPhoneNumber(event.target.value)
  }

  const handlePayNowNameChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setPayNowName(event.target.value)
  }

  // Constructing the UEN (phone number with country code)
  const uen = `${countryCode}${phoneNumber}`

  // PayNow options for QR code generation
  const opts = {
    uen, // UEN (international phone number)
    name: payNowName || "Payee", // Default to "Payee" if name is not provided
    editable: 1, // Allow editing of the payment amount
    expiry: "20990106", // A far-off expiry date
    amount: 0, // Set the initial amount as 0
    refNumber: "", // Reference number (optional)
  }

  // Generate the PayNow QR code value
  const qrCodeValue = generatePayNowStr(opts)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      // 检查屏幕高度变化，判断键盘是否弹出
      if (window.innerHeight < document.documentElement.clientHeight) {
        setIsKeyboardVisible(true) // 键盘已弹出
      } else {
        setIsKeyboardVisible(false) // 键盘已收起
      }
    }

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [])
  return (
    <Container
      maxWidth="xs"
      sx={{
        height: isKeyboardVisible ? "calc(100vh - 50px)" : "100vh", // 如果键盘弹出，调整高度
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        paddingBottom: isKeyboardVisible ? "50px" : "0", // 增加键盘显示时的下方填充
      }}
    >
      {/* Phone number input section */}
      <Box
        sx={{
          width: "100%",
          mb: 4,
        }}
      >
        <TextField
          select
          label="国家代码"
          value={countryCode}
          onChange={handleCountryChange}
          variant="outlined"
          sx={{ width: "30%", mr: 1 }}
        >
          <MenuItem value="+65">+65 新加坡</MenuItem>
          <MenuItem value="+86">+86 中国</MenuItem>
        </TextField>
        <TextField
          label="手机号"
          variant="outlined"
          value={phoneNumber}
          onChange={handlePhoneNumberChange}
          sx={{ width: "65%" }}
        />
      </Box>

      {/* PayNow Name input */}
      <Box
        sx={{
          width: "100%",
          mb: 4,
        }}
      >
        <TextField
          label="PayNow 名字"
          variant="outlined"
          fullWidth
          value={payNowName}
          onChange={handlePayNowNameChange}
        />
      </Box>

      {/* QR code display */}
      <Box
        sx={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            width: "80%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)", // 添加阴影效果
            padding: "16px", // 添加一些内边距
            borderRadius: "8px", // 添加圆角
            backgroundColor: "#fff", // 设置背景颜色
          }}
        >
          <Box sx={{ height: "8svh" }}>
            <Box sx={{ height: "4.4svh" }}>
              <p style={{ textAlign: "center", fontSize: "25px", margin: "0" }}>
                <b>{payNowName}</b>
              </p>
            </Box>
            <Box sx={{ height: "3svh" }}>
              <p
                style={{
                  textAlign: "center",
                  color: "#645f60",
                  fontSize: "20px",
                  margin: "0",
                }}
              >
                {countryCode + " " + phoneNumber}
              </p>
            </Box>
          </Box>
          <QRCode
            style={{ marginBottom: "10px" }}
            value={qrCodeValue}
            size={250} // Set the size for the QR code
            fgColor="#771976" // Customizing the QR code color to match PayNow
            logoImage={paynowImg} // Adding PayNow logo in the center
            logoHeight={60} // Set only the height to preserve aspect ratio (logo will maintain original width proportionally)
            logoWidth={90} // Set only the width to preserve aspect ratio (logo will maintain original height proportionally)
            quietZone={10} // Adds more margin around the QR code
            logoOpacity={1} // Ensure logo opacity is fully visible
            removeQrCodeBehindLogo={true} // Ensures the logo does not overlap the QR code pattern
            eyeRadius={[
              { outer: 0, inner: 0 }, // Customize the corners to make them less round
              { outer: 0, inner: 0 },
              { outer: 0, inner: 0 },
            ]}
          />
          <Button
            variant="contained"
            color="secondary"
            sx={{ backgroundColor: "#771976" }}
          >
            SCAN TO PAY
          </Button>
        </Box>
      </Box>
    </Container>
  )
}

export default PayNowComponent
