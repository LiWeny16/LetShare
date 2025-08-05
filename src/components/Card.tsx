import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useNavigate } from "react-router-dom";
import TranslateIcon from "@mui/icons-material/Translate";
import { styled } from "@mui/material/styles";

// 自定义样式组件
const StyledCard = styled(Card)(({  }) => ({
  maxWidth: 345,
  borderRadius: "20px",
  background: "linear-gradient(145deg, #ffffff, #f0f0f0)",
  boxShadow: "10px 10px 20px #d1d1d1, -10px -10px 20px #ffffff",
  transition: "transform 0.3s ease, box-shadow 0.3s ease, background 0.3s ease",
  overflow: "hidden",
  position: "relative",
  "&:hover": {
    boxShadow: "15px 15px 30px #d1d1d1, -15px -15px 30px #ffffff",
    transform: "translateY(-8px)",
    background: "linear-gradient(145deg, #f0f0f0, #ffffff)",
  },
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "4px",
    background: "linear-gradient(90deg, #6a11cb 0%, #2575fc 100%)",
    transition: "height 0.3s ease",
  },
  "&:hover::before": {
    height: "6px",
  },
}));

const IconContainer = styled("div")({
  display: "flex",
  justifyContent: "center",
  padding: "20px 0",
  "& svg": {
    fontSize: "4rem",
    color: "#2575fc",
    transition: "transform 0.3s ease, color 0.3s ease",
  },
  "&:hover svg": {
    transform: "scale(1.1)",
    color: "#6a11cb",
  },
});

const StyledButton = styled(Button)(({ }) => ({
  borderRadius: "20px",
  fontWeight: "bold",
  transition: "all 0.3s ease",
  "&:hover": {
    transform: "translateY(-2px)",
    boxShadow: "0 5px 15px rgba(0,0,0,0.2)",
  },
}));

export default function MediaCard(props: any) {
  const navigate = useNavigate();
  const handleClick = () => {
    navigate(props.url);
  };

  return (
    <StyledCard>
      <IconContainer>
        <TranslateIcon />
      </IconContainer>
      <CardContent>
        <Typography
          gutterBottom
          variant="h5"
          component="div"
          sx={{
            fontWeight: "bold",
            textAlign: "center",
            background: "linear-gradient(90deg, #6a11cb 0%, #2575fc 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {props.title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            textAlign: "center",
            lineHeight: 1.6,
            minHeight: "60px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          {props.content}
        </Typography>
      </CardContent>
      <CardActions sx={{ justifyContent: "center", pb: 2 }}>
        <StyledButton
          onClick={handleClick}
          size="small"
          variant="contained"
          sx={{
            background: "linear-gradient(90deg, #6a11cb 0%, #2575fc 100%)",
            color: "white",
            mr: 1,
          }}
        >
          Visit
        </StyledButton>
        <StyledButton
          onClick={handleClick}
          size="small"
          variant="outlined"
          sx={{
            borderColor: "#2575fc",
            color: "#2575fc",
            "&:hover": {
              borderColor: "#6a11cb",
              color: "#6a11cb",
            },
          }}
        >
          访问
        </StyledButton>
      </CardActions>
    </StyledCard>
  );
}