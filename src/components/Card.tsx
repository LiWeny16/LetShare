import Card from "@mui/material/Card"
import CardActions from "@mui/material/CardActions"
import CardContent from "@mui/material/CardContent"
import Button from "@mui/material/Button"
import Typography from "@mui/material/Typography"
import { useNavigate } from "react-router-dom"
import TranslateIcon from "@mui/icons-material/Translate"

export default function MediaCard(props: any) {
  const navigate = useNavigate()
  const handleClick = () => {
    navigate(props.url)
  }

  return (
    <Card
      sx={{
        maxWidth: 345,
        borderRadius: "30px",
        background: "#e0e0e0",
        boxShadow: "20px 20px 39px #bebebe, -20px -20px 39px #eaeaea4a",
        transition: "transform 0.3s ease, box-shadow 0.3s ease",
        "&:hover": {
          boxShadow: "30px 30px 60px #bebebe, -30px -30px 60px #eaeaea4a",
          transform: "translateY(-5px) scale(1.05)",
        },
      }}
    >
      {/* <CardMedia
        onClick={() => {
          handleClick()
        }}
        sx={{ height: 140, cursor: "pointer" }}
        image={TranslateIcon.toString()}
      /> */}
      <center><TranslateIcon /></center>
      <CardContent>
        <Typography gutterBottom variant="h5" component="div">
          {props.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {props.content}
        </Typography>
      </CardContent>
      <CardActions>
        <Button
          onClick={() => {
            handleClick()
          }}
          size="small"
        >
          Visit
        </Button>
        <Button
          onClick={() => {
            handleClick()
          }}
          size="small"
        >
          访问
        </Button>
      </CardActions>
    </Card>
  )
}
