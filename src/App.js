import React from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Paper,
  Box,
  CssBaseline,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import FileUpload from "./FileUpload";

const theme = createTheme({
  palette: {
    primary: { main: "#1e3a8a" },  
    secondary: { main: "#f59e0b" },
    background: { default: "#f5f7fb" },
  },
  typography: {
    fontFamily: "Manrope, Roboto, system-ui, Arial, sans-serif",
    h2: { fontWeight: 800, letterSpacing: "-0.015em" },
    h6: { fontWeight: 600 },
  },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {/* Hero Header */}
      <AppBar
        position="static"
        color="primary"
        elevation={0}
        sx={{
          height: { xs: 160, sm: 200 },
          justifyContent: "center",
          backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)),
            url('/header.jpg')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: "1 !important",
            px: { xs: 2, md: 4 },
            width: "100%",
          }}
        >
          <Box sx={{ width: "100%" }}>
            <Box
              component="img"
              src="/logo.svg"
              alt="Bioinfo Visualizer Logo"
              sx={{
                height: { xs: 60, sm: 80, md: 550 }, // adjust size here
                objectFit: "contain",
                mt: 2,
              }}
            />
          </Box>
        </Toolbar>
      </AppBar>

      {/* Background image area */}
      <Box
        sx={{
          minHeight: "100vh",
          backgroundImage: "url('/background.svg')", // background image made on Canva
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed", 
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 4,
        }}
      >
        {/* Main content box */}
        <Container maxWidth="lg">
          <Paper
            elevation={3}
            sx={{
              p: { xs: 2, sm: 3, md: 4 },
              borderRadius: 3,
              backgroundColor: "rgba(255, 255, 255, 0.85)", // transparent white overlay
              backdropFilter: "blur(3px)",
            }}
          >
            <FileUpload />
          </Paper>
        </Container>

        {/* Subtle footer */}
        <Box sx={{ textAlign: "center", pt: 4, color: "text.secondary" }}>
          <Typography variant="caption">
            Tip: First column should be <b>Gene names</b>; remaining columns are <b>numeric samples</b>.
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
