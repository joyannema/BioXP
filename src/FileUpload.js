import React, { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import Plot from "react-plotly.js";
import {
  Box,
  Stack,
  Button,
  Typography,
  Alert,
  LinearProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  TextField,
} from "@mui/material";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

export default function FileUpload() {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedSample, setSelectedSample] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [apiSummary, setApiSummary] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [saveStatus, setSaveStatus] = useState(""); // "", "saving", "saved", "error"
  const [savedProjectId, setSavedProjectId] = useState(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const plotRef = useRef(null);

  async function callAnalyzeApi(file) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(
        errJson.details
          ? `${errJson.error}: ${errJson.details}`
          : errJson.error || `API analyze failed (status ${res.status})`
      );
    }

    return res.json();
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setSaveStatus("");
    setSavedProjectId(null);
    setErr("");
    setLoading(true);
    setApiSummary(null);

    try {
      // 1) Backend summary (doesn't replace charts)
      const summary = await callAnalyzeApi(file);
      setApiSummary(summary);

      // 2) Frontend parsing for charts/table/heatmap
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        worker: true,
        skipEmptyLines: "greedy",
        complete: (res) => {
          try {
            const raw = (res.data || []).filter(
              (r) =>
                r &&
                r.Gene !== null &&
                r.Gene !== undefined &&
                String(r.Gene).trim() !== ""
            );

            if (!raw.length) {
              throw new Error("No valid rows found. Ensure first column is 'Gene'.");
            }

            const keys = Object.keys(raw[0]);
            if (!keys.includes("Gene")) {
              throw new Error("Missing required 'Gene' column.");
            }

            const sampleCols = keys.filter((k) => k !== "Gene");
            const numericCols = sampleCols.filter((k) =>
              raw.some((r) => typeof r[k] === "number" && !Number.isNaN(r[k]))
            );

            if (!numericCols.length) {
              throw new Error("No numeric sample columns detected.");
            }

            const cleaned = raw.map((r) => {
              const obj = { Gene: String(r.Gene) };
              numericCols.forEach((c) => {
                const v = r[c];
                obj[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
              });
              return obj;
            });

            setRows(cleaned);
            setColumns(["Gene", ...numericCols]);
            setSelectedSample((prev) => (prev && numericCols.includes(prev) ? prev : numericCols[0]));
          } catch (e) {
            setRows([]);
            setColumns([]);
            setSelectedSample("");
            setErr(e.message || "Failed to parse CSV.");
          } finally {
            setLoading(false);
          }
        },
        error: (e) => {
          setErr(`Error parsing CSV: ${e?.message || e}`);
          setLoading(false);
        },
      });
    } catch (e) {
      setErr(e.message || "Failed to analyze CSV.");
      setLoading(false);
    }
  };

  async function saveProject() {
    if (!uploadedFile) return setErr("Upload a CSV first.");
    if (!apiSummary) return setErr("Wait for analysis summary before saving.");

    setErr("");
    setSaveStatus("saving");

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("name", uploadedFile.name || "Untitled Project");
      // send chart config too
      formData.append("chart_config", JSON.stringify({ selectedSample, columns }));

      const res = await fetch("/api/projects/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson.details ? `${errJson.error}: ${errJson.details}` : (errJson.error || `Save failed (status ${res.status})`)
      );
      }

      const out = await res.json();
      setSavedProjectId(out.id);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      setErr(e.message || "Failed to save project.");
    }
  }

  async function fetchProjectsList() {
    setProjectsLoading(true);
    setErr("");

    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to load projects");
      }
      const list = await res.json();
      setProjects(list);
    } catch (e) {
      setErr(e.message || "Failed to load projects.");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadProject(projectId) {
    try {
      setLoading(true);
      setErr("");
      setRows([]);
      setColumns([]);
      setSelectedSample("");

      // 1) Fetch project metadata
      const metaRes = await fetch(`/api/projects/${projectId}`);
      if (!metaRes.ok) {
        throw new Error("Project not found");
      }
      const meta = await metaRes.json();

      // Restore summary
      setApiSummary(meta.dataset_summary || null);

      // 2) Fetch CSV file
      const fileRes = await fetch(`/api/projects/${projectId}/file`);
      if (!fileRes.ok) {
        throw new Error("Failed to download dataset file");
      }
      const csvText = await fileRes.text();

      // 3) Parse CSV (same logic as upload)
      const parsed = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: "greedy",
      });

      const raw = (parsed.data || []).filter(
        (r) =>
          r &&
          r.Gene !== null &&
          r.Gene !== undefined &&
          String(r.Gene).trim() !== ""
      );

      if (!raw.length) {
        throw new Error("Saved CSV contains no valid rows");
      }

      const keys = Object.keys(raw[0]);
      if (!keys.includes("Gene")) {
        throw new Error("Saved CSV missing 'Gene' column");
      }

      const sampleCols = keys.filter((k) => k !== "Gene");
      const numericCols = sampleCols.filter((k) =>
        raw.some((r) => typeof r[k] === "number" && !Number.isNaN(r[k]))
      );

      const cleaned = raw.map((r) => {
        const obj = { Gene: String(r.Gene) };
        numericCols.forEach((c) => {
          const v = r[c];
          obj[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
       });
        return obj;
      });

      setRows(cleaned);
      setColumns(["Gene", ...numericCols]);

      // Restore chart config
      const savedSample = meta.chart_config?.selectedSample;
      setSelectedSample(
        savedSample && numericCols.includes(savedSample)
          ? savedSample
          : numericCols[0] || ""
      );

      setSavedProjectId(meta.id);
    } catch (e) {
      setErr(e.message || "Failed to load project");
    } finally {
      setLoading(false);
    }
  }

  // ✅ MUST be outside onFile
  const xLabels = useMemo(() => columns.filter((c) => c !== "Gene"), [columns]);
  const yLabels = useMemo(() => rows.map((r) => r.Gene), [rows]);

  const heatmapZ = useMemo(() => {
    if (!rows.length || !xLabels.length) return [];
    return rows.map((r) => xLabels.map((c) => (typeof r[c] === "number" ? r[c] : null)));
  }, [rows, xLabels]);

  const handleSampleChange = (e) => setSelectedSample(e.target.value);

  return (
    <Box>
      <Stack spacing={2}>
        <Typography variant="h6">Upload your gene expression CSV</Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
          <Button variant="contained" component="label">
            Choose CSV
            <input type="file" accept=".csv" hidden onChange={onFile} />
          </Button>

          <Button
            variant="outlined"
            onClick={async () => {
              setOpenDialog(true);
              await fetchProjectsList();
            }}
          >
            Open existing project
          </Button>

          {rows.length > 0 && apiSummary && (
            <Button
              variant="outlined"
              onClick={saveProject}
              disabled={saveStatus === "saving"}
            >
              {saveStatus === "saving" ? "Saving..." : "Save project"}
            </Button>
          )}

          {saveStatus === "saved" && savedProjectId && (
            <Alert severity="success">Saved</Alert>
          )}
        </Stack>


        {loading && <LinearProgress />}
        {err && <Alert severity="error">{err}</Alert>}
    
        {rows.length > 0 && (
          <>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ xs: "stretch", sm: "center" }}
              justifyContent="space-between"
              sx={{ mt: 1 }}
            >
              <Typography variant="subtitle1">
                {`Loaded ${rows.length.toLocaleString()} genes · ${xLabels.length} samples`}
              </Typography>

              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="sample-label">Sample</InputLabel>
                <Select
                  labelId="sample-label"
                  value={selectedSample}
                  label="Sample"
                  onChange={handleSampleChange}
                >
                  {xLabels.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                Data Table
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360, borderRadius: 2 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {columns.map((c) => (
                        <TableCell key={c} sx={{ fontWeight: 700 }}>
                          {c}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.slice(0, 200).map((r, i) => (
                      <TableRow key={i} hover>
                        {columns.map((c) => (
                          <TableCell key={c}>{c === "Gene" ? r[c] : r[c] ?? ""}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {rows.length > 200 && (
                <Typography variant="caption" color="text.secondary">
                  Showing first 200 rows.
                </Typography>
              )}
            </Box>

            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" gutterBottom>
                Gene Expression — {selectedSample}
              </Typography>
              <Box sx={{ width: "100%", height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="Gene" hide />
                    <YAxis />
                    <Tooltip />
                    <Bar
                      dataKey={selectedSample}
                      fill="#0A1F44"   // navy blue
                      radius={[4, 4, 0, 0]} // optional: rounded top corners (looks nicer)
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Box>

            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" gutterBottom>
                Heatmap of Gene Expression
              </Typography>
              <Plot
                ref={plotRef}
                data={[
                  {
                    z: heatmapZ,
                    x: xLabels,
                    y: yLabels,
                    type: "heatmap",
                    colorscale: "Blues",
                    hovertemplate: "Sample: %{x}<br>Gene: %{y}<br>Value: %{z}<extra></extra>",
                    showscale: true,
                  },
                ]}
                layout={{
                  autosize: true,
                  margin: { l: 80, r: 20, t: 30, b: 60 },
                  xaxis: { title: "Samples", automargin: true },
                  yaxis: { title: "Genes", automargin: true },
                }}
                useResizeHandler
                style={{ width: "100%", height: "520px" }}
                config={{ displaylogo: false, responsive: true }}
              />
            </Box>
          </>
        )}
      </Stack>
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Open a saved project</DialogTitle>

        <DialogContent dividers>
          <TextField
            fullWidth
            size="small"
            label="Search by name"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            sx={{ mb: 2 }}
          />

          {projectsLoading ? (
            <Typography variant="body2">Loading projects…</Typography>
          ) : (
            <List dense>
              {projects
                .filter((p) =>
                  (p.name || "")
                    .toLowerCase()
                    .includes(projectSearch.trim().toLowerCase())
                )
                .map((p) => (
                  <ListItemButton
                    key={p.id}
                    onClick={async () => {
                      setOpenDialog(false);
                      try {
                        await loadProject(p.id); // you’ll implement / already have this
                      } catch (e) {
                        setErr(e.message || "Failed to open project.");
                      }
                    }}
                  >
                    <ListItemText
                      primary={p.name || p.original_filename || p.id}
                      secondary={
                  `     ${p.rowCount ?? "?"} rows · ${p.columnCount ?? "?"} cols` +
                        (p.created_at ? ` · ${new Date(p.created_at).toLocaleString()}` : "")
                      }
                    />
                  </ListItemButton>
                ))}
            </List>
          )}

          {!projectsLoading && projects.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No saved projects yet.
            </Typography>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
