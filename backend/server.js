require("dotenv").config();
console.log("SERVER FILE LOADED");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Papa = require("papaparse");
const supabase = require("./supabaseClient");
const app = express();
app.use(express.json()); // needed for JSON bodies
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

function isNumber(x) {
  if (x === null || x === undefined) return false;
  const s = String(x).trim();
  if (s === "") return false;
  return !Number.isNaN(Number(s));
}

app.post("/api/analyze", upload.single("file"), (req, res) => {
  console.log("HIT /api/analyze", {
    hasFile: !!req.file,
    fieldname: req.file?.fieldname,
    originalname: req.file?.originalname,
    mimetype: req.file?.mimetype,
    size: req.file?.size,
    hasBuffer: !!req.file?.buffer,
  });

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'file'." });
    }

    if (!req.file.buffer) {
      return res.status(400).json({
        error: "File uploaded but no buffer received (multer memoryStorage issue).",
      });
    }

    const csvText = req.file.buffer.toString("utf-8");

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false
    });

    if (parsed.errors && parsed.errors.length > 0) {
      return res.status(400).json({
        error: "CSV parse error",
        details: parsed.errors.slice(0, 3)
      });
    }

    const rows = parsed.data;
    const columns = parsed.meta.fields || [];

    if (columns.length === 0) {
      return res.status(400).json({ error: "No columns detected. Is this a valid header CSV?" });
    }

    // Missing values per column
    const missingByColumn = {};
    for (const col of columns) missingByColumn[col] = 0;

    for (const row of rows) {
      for (const col of columns) {
        const v = row[col];
        if (v === undefined || v === null || String(v).trim() === "") {
          missingByColumn[col] += 1;
        }
      }
    }

    // Basic numeric stats for numeric columns: mean + variance (sample variance-ish)
    const numericCols = columns.filter((c) => rows.some((r) => isNumber(r[c])));

    const stats = {};
    for (const col of numericCols) {
      let n = 0;
      let sum = 0;
      let sumSq = 0;

      for (const r of rows) {
        const v = r[col];
        if (!isNumber(v)) continue;
        const x = Number(v);
        n += 1;
        sum += x;
        sumSq += x * x;
      }

      if (n === 0) continue;
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean); // population variance
      stats[col] = { n, mean, variance };
    }

    // Optional: top variable numeric columns (nice for “top variable genes” idea)
    const topVariable = Object.entries(stats)
      .sort((a, b) => b[1].variance - a[1].variance)
      .slice(0, 10)
      .map(([col, s]) => ({ feature: col, variance: s.variance, mean: s.mean, n: s.n }));

    // Preview first 10 rows (safe for UI)
    const preview = rows.slice(0, 10);

    res.json({
      rowCount: rows.length,
      columnCount: columns.length,
      columns,
      missingByColumn,
      numericColumnCount: numericCols.length,
      topVariable,
      preview
    });
  } catch (e) {
    console.error("ANALYZE ERROR STACK:", e?.stack || e);
    res.status(500).json({ error: "Server error", details: e?.stack || String(e) });
    }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/projects", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, original_filename, created_at, dataset_summary")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Optional: keep response light (no huge JSON)
    const cleaned = (data || []).map((p) => ({
      id: p.id,
      name: p.name,
      original_filename: p.original_filename,
      created_at: p.created_at,
      rowCount: p.dataset_summary?.rowCount ?? null,
      columnCount: p.dataset_summary?.columnCount ?? null,
    }));

    res.json(cleaned);
  } catch (e) {
    console.error("LIST PROJECTS ERROR:", e);
    res.status(500).json({ error: "Failed to list projects", details: String(e) });
  }
});


app.post("/api/projects", async (req, res) => {
  try {
    const { name, dataset_summary, chart_config } = req.body;
    if (!name || !dataset_summary || !chart_config) {
      return res.status(400).json({ error: "Missing name, dataset_summary, or chart_config." });
    }

    const { data, error } = await supabase
      .from("projects")
      .insert([{ name, dataset_summary, chart_config }])
      .select("id")
      .single();

    if (error) throw error;
    res.json({ id: data.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save project", details: String(e) });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: "Project not found" });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load project", details: String(e) });
  }
});

app.post("/api/projects/upload", upload.single("file"), async (req, res) => {
  try {
    const name = req.body?.name || "Untitled Project";
    let chart_config = { selectedSample: null };

      if (req.body?.chart_config) {
        try {
          chart_config = JSON.parse(req.body.chart_config);
        } catch (e) {
          console.warn("Invalid chart_config JSON, using default");
        }
    }


    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')." });
    }

    // 1) Upload file to Supabase Storage
    const filenameSafe = (req.file.originalname || "dataset.csv").replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${Date.now()}_${filenameSafe}`;

    const { data: storageData, error: storageErr } = await supabase.storage
      .from("bioxp-uploads")
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype || "text/csv",
        upsert: false,
      });

    if (storageErr) {
      console.error("SUPABASE STORAGE ERROR:", storageErr);
      throw storageErr;
}

    // 2) (Optional) run analysis right here so we store summary in DB
    const csvText = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const columns = parsed.meta.fields || [];
    const rowCount = (parsed.data || []).length;

    const dataset_summary = {
      rowCount,
      columnCount: columns.length,
      columns,
      originalName: req.file.originalname,
      storagePath,
    };

    // 3) Insert DB row
    const { data: dbData, error: dbErr } = await supabase
      .from("projects")
      .insert([
        {
          name,
          dataset_summary,
          chart_config,                 // <-- use parsed config
          file_path: storagePath,
          original_filename: req.file.originalname || null,
        },
      ])
      .select("id")
      .single();

    if (dbErr) {
      console.error("SUPABASE DB INSERT ERROR:", dbErr);
      throw dbErr;
    }

    res.json({ id: dbData.id, storagePath });
  } catch (e) {
    console.error("UPLOAD PROJECT ERROR (raw):", e);
    console.error("UPLOAD PROJECT ERROR (stringified):", JSON.stringify(e, null, 2));

    res.status(500).json({
      error: "Failed to upload project",
      details: e?.message || e?.error || e?.details || JSON.stringify(e),
    });
  }
});

app.get("/api/projects/:id/file", async (req, res) => {
  try {
    const { id } = req.params;

    // find project row to get file_path
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("file_path, original_filename")
      .eq("id", id)
      .single();

    if (projErr || !project?.file_path) {
      return res.status(404).json({ error: "File not found for this project" });
    }

    // download from storage bucket
    const { data: blob, error: dlErr } = await supabase.storage
      .from("bioxp-uploads")
      .download(project.file_path);

    if (dlErr) throw dlErr;

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${project.original_filename || "dataset.csv"}"`
    );
    res.send(buffer);
  } catch (e) {
    console.error("GET FILE ERROR:", e);
    res.status(500).json({ error: "Failed to fetch file", details: String(e) });
  }
});


const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

