import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";

const els = {
  fileInput: document.querySelector("#fileInput"),
  demoButton: document.querySelector("#demoButton"),
  htmlInput: document.querySelector("#htmlInput"),
  renderHtmlButton: document.querySelector("#renderHtmlButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  sampleHtmlButton: document.querySelector("#sampleHtmlButton"),
  zoomSelect: document.querySelector("#zoomSelect"),
  precisionSelect: document.querySelector("#precisionSelect"),
  viewer: document.querySelector("#viewer"),
  statusText: document.querySelector("#statusText"),
  pageValue: document.querySelector("#pageValue"),
  xValue: document.querySelector("#xValue"),
  yValue: document.querySelector("#yValue"),
  copyButton: document.querySelector("#copyButton"),
  clearButton: document.querySelector("#clearButton"),
  marksList: document.querySelector("#marksList"),
};

let pdfDocument = null;
let currentBytes = null;
let currentName = "";
let currentMode = "empty";
let htmlPageCount = 0;
let renderedHtmlSource = "";
let activeCoordinate = null;
let marks = [];
let htmlRenderJobId = 0;

const pageStates = new Map();
const A4_PAGE_WIDTH = 595;
const A4_PAGE_HEIGHT = 842;
const A4_PAGE_MARGIN = 36;
const A4_CONTENT_HEIGHT = A4_PAGE_HEIGHT - A4_PAGE_MARGIN * 2;
const PRINT_DIALOG_DELAY_MS = 600;

function setStatus(text) {
  els.statusText.textContent = text;
}

function formatNumber(value) {
  const precision = Number(els.precisionSelect.value);
  return Number(value).toFixed(precision);
}

function setActiveCoordinate(coordinate) {
  activeCoordinate = coordinate;
  if (!coordinate) {
    els.pageValue.textContent = "-";
    els.xValue.textContent = "-";
    els.yValue.textContent = "-";
    els.copyButton.disabled = true;
    return;
  }

  els.pageValue.textContent = coordinate.page;
  els.xValue.textContent = formatNumber(coordinate.x);
  els.yValue.textContent = formatNumber(coordinate.y);
  els.copyButton.disabled = false;
}

function coordinateText(coordinate) {
  return `page=${coordinate.page}, x=${formatNumber(coordinate.x)}, y=${formatNumber(coordinate.y)}`;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 1600);
}

function updateMarksList() {
  els.clearButton.disabled = marks.length === 0;
  if (marks.length === 0) {
    els.marksList.innerHTML = '<li class="empty">点击 PDF 页面添加坐标点</li>';
    return;
  }

  els.marksList.innerHTML = "";
  marks.forEach((mark, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${coordinateText(mark)}`;
    els.marksList.append(item);
  });
}

function updateExportButton() {
  els.exportPdfButton.disabled = currentMode !== "html" || htmlPageCount === 0;
}

function resetHtmlState() {
  htmlPageCount = 0;
  renderedHtmlSource = "";
  updateExportButton();
}

function getPageCoordinate(event, pageShell) {
  const state = pageStates.get(pageShell);
  if (!state) return null;

  const rect = state.surface.getBoundingClientRect();
  const viewportX = event.clientX - rect.left;
  const viewportY = event.clientY - rect.top;

  if (viewportX < 0 || viewportY < 0 || viewportX > rect.width || viewportY > rect.height) {
    return null;
  }

  let pdfX;
  let pdfY;
  if (state.mode === "html") {
    pdfX = (viewportX / rect.width) * state.pdfWidth;
    pdfY = state.pdfHeight - (viewportY / rect.height) * state.pdfHeight;
  } else {
    const scaleX = state.viewport.width / rect.width;
    const scaleY = state.viewport.height / rect.height;
    [pdfX, pdfY] = state.viewport.convertToPdfPoint(viewportX * scaleX, viewportY * scaleY);
  }

  return {
    page: state.pageNumber,
    x: pdfX,
    y: pdfY,
    viewportX,
    viewportY,
    pageShell,
  };
}

function addCrosshair(coordinate) {
  const marker = document.createElement("div");
  marker.className = "crosshair";
  marker.style.left = `${coordinate.viewportX}px`;
  marker.style.top = `${coordinate.viewportY}px`;
  coordinate.pageShell.append(marker);
}

async function renderPdf() {
  if (!pdfDocument) {
    els.viewer.innerHTML = '<div class="empty-state">选择 PDF 或渲染 HTML 后，在页面上移动鼠标查看坐标，点击可记录坐标点。</div>';
    return;
  }

  currentMode = "pdf";
  resetHtmlState();
  pageStates.clear();
  marks = [];
  updateMarksList();
  setActiveCoordinate(null);
  els.viewer.innerHTML = "";

  const scale = Number(els.zoomSelect.value);
  setStatus(`正在渲染 ${currentName || "PDF"} ...`);

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    const pageShell = document.createElement("div");
    pageShell.className = "pdf-page";
    pageShell.style.width = `${viewport.width}px`;
    pageShell.style.height = `${viewport.height}px`;
    pageShell.dataset.page = String(pageNumber);

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `第 ${pageNumber} 页`;

    pageShell.append(canvas, label);
    els.viewer.append(pageShell);

    pageStates.set(pageShell, { mode: "pdf", pageNumber, page, viewport, surface: canvas, canvas });

    pageShell.addEventListener("mousemove", (event) => {
      const coordinate = getPageCoordinate(event, pageShell);
      setActiveCoordinate(coordinate);
    });

    pageShell.addEventListener("mouseleave", () => {
      setActiveCoordinate(null);
    });

    pageShell.addEventListener("click", (event) => {
      const coordinate = getPageCoordinate(event, pageShell);
      if (!coordinate) return;
      marks.push({ page: coordinate.page, x: coordinate.x, y: coordinate.y });
      addCrosshair(coordinate);
      updateMarksList();
    });

    await page.render({ canvasContext: context, viewport }).promise;
  }

  setStatus(`${currentName || "PDF"}，共 ${pdfDocument.numPages} 页`);
}

async function loadPdf(bytes, name) {
  currentBytes = bytes;
  currentName = name;
  currentMode = "pdf";
  setStatus(`正在加载 ${name} ...`);

  try {
    pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
    await renderPdf();
  } catch (error) {
    console.error(error);
    pdfDocument = null;
    resetHtmlState();
    els.viewer.innerHTML = '<div class="empty-state">PDF 加载失败，请确认文件格式。</div>';
    setStatus("PDF 加载失败");
  }
}

function normalizeHtmlInput(value) {
  const content = value.trim();
  if (!content) return "";
  if (/<!doctype|<html[\s>]/i.test(content)) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    const styleText = Array.from(doc.head.querySelectorAll("style"))
      .map((style) => {
        const mappedCss = style.textContent
          .replace(/(^|[,{]\s*)html(?=[\s.#:{,>])/gi, "$1.html-content")
          .replace(/(^|[,{]\s*)body(?=[\s.#:{,>])/gi, "$1.html-content");
        return `<style>${mappedCss}</style>`;
      })
      .join("\n");
    return `${styleText}\n${doc.body.innerHTML}`;
  }
  return content;
}

function renderHtmlPreview() {
  renderHtmlPreviewAsync();
}

async function waitForLayoutAssets(root) {
  await waitForImages(root);
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
}

async function measureHtmlDocument(html) {
  const measurer = document.createElement("div");
  measurer.className = "html-measurer";
  const content = document.createElement("div");
  content.className = "html-content";
  content.innerHTML = html;
  measurer.append(content);
  document.body.append(measurer);
  await waitForLayoutAssets(content);
  const height = Math.max(content.scrollHeight, content.offsetHeight, A4_CONTENT_HEIGHT);

  measurer.remove();
  return Math.ceil(height);
}

async function waitForImages(root) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

async function renderHtmlPreviewAsync() {
  const jobId = htmlRenderJobId + 1;
  htmlRenderJobId = jobId;
  const html = normalizeHtmlInput(els.htmlInput.value);
  if (!html) {
    showToast("请先输入 HTML");
    return;
  }

  currentMode = "html";
  resetHtmlState();
  pdfDocument = null;
  currentBytes = null;
  currentName = "HTML 预览";
  els.renderHtmlButton.disabled = true;
  pageStates.clear();
  marks = [];
  updateMarksList();
  setActiveCoordinate(null);
  els.viewer.innerHTML = "";

  try {
    setStatus("正在分页渲染 HTML ...");
    const pageWidth = A4_PAGE_WIDTH;
    const pageHeight = A4_PAGE_HEIGHT;
    const pageContentHeight = A4_CONTENT_HEIGHT;
    const contentHeight = await measureHtmlDocument(html);
    if (jobId !== htmlRenderJobId) return;

    const pageCount = Math.max(1, Math.ceil(contentHeight / pageContentHeight));
    htmlPageCount = pageCount;
    renderedHtmlSource = html;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (jobId !== htmlRenderJobId) return;

      const pageShell = document.createElement("div");
      pageShell.className = "html-page";
      pageShell.dataset.page = String(pageNumber);

      const label = document.createElement("div");
      label.className = "page-label";
      label.textContent = `HTML 第 ${pageNumber} 页`;

      const pageBody = document.createElement("div");
      pageBody.className = "html-page-body";

      const content = document.createElement("div");
      content.className = "html-content";
      content.innerHTML = html;
      content.style.minHeight = `${contentHeight}px`;
      content.style.setProperty("--html-page-offset-screen", `-${(pageNumber - 1) * pageContentHeight}px`);
      content.style.setProperty("--html-page-offset-print", `-${(pageNumber - 1) * pageContentHeight}pt`);

      pageBody.append(content);
      pageShell.append(pageBody, label);
      els.viewer.append(pageShell);
      pageStates.set(pageShell, {
        mode: "html",
        pageNumber,
        pdfWidth: pageWidth,
        pdfHeight: pageHeight,
        surface: pageShell,
      });

      pageShell.addEventListener("mousemove", (event) => {
        const coordinate = getPageCoordinate(event, pageShell);
        setActiveCoordinate(coordinate);
      });

      pageShell.addEventListener("mouseleave", () => {
        setActiveCoordinate(null);
      });

      pageShell.addEventListener("click", (event) => {
        const coordinate = getPageCoordinate(event, pageShell);
        if (!coordinate) return;
        marks.push({ page: coordinate.page, x: coordinate.x, y: coordinate.y });
        addCrosshair(coordinate);
        updateMarksList();
      });
    }

    setStatus(`HTML 预览，共 ${pageCount} 页，按 A4 595 x 842 坐标显示`);
    updateExportButton();
  } catch (error) {
    console.error(error);
    resetHtmlState();
    els.viewer.innerHTML = '<div class="empty-state">HTML 渲染失败，请检查输入内容。</div>';
    setStatus("HTML 渲染失败");
  } finally {
    if (jobId === htmlRenderJobId) {
      els.renderHtmlButton.disabled = false;
    }
  }
}

async function exportHtmlPdf() {
  const html = normalizeHtmlInput(els.htmlInput.value);
  if (!html) {
    showToast("请先输入 HTML");
    return;
  }

  if (currentMode !== "html" || htmlPageCount === 0 || renderedHtmlSource !== html) {
    await renderHtmlPreviewAsync();
  }

  if (currentMode !== "html" || htmlPageCount === 0) return;

  setStatus(`准备导出 HTML PDF，共 ${htmlPageCount} 页`);
  window.setTimeout(() => {
    window.print();
  }, PRINT_DIALOG_DELAY_MS);
}

window.addEventListener("afterprint", () => {
  if (currentMode === "html" && htmlPageCount > 0) {
    setStatus(`HTML 预览，共 ${htmlPageCount} 页，按 A4 595 x 842 坐标显示`);
  }
});

function fillSampleHtml() {
  els.htmlInput.value = `<h1 style="text-align:center;margin-bottom:32px;">借款协议</h1>
<p>甲方：张三</p>
<p>乙方：示例小贷有限公司</p>
<p>本协议用于演示 HTML 协议预览和签章坐标定位。请将实际协议 HTML 粘贴到这里。</p>
<div style="height:1180px;padding-top:20px;">
  <p>这里模拟长协议正文，多页内容会按 A4 高度自动分页展示。</p>
</div>
<div style="display:flex;justify-content:space-between;gap:40px;">
  <div style="width:180px;border-top:1px solid #111;padding-top:8px;">借款人签字</div>
  <div style="width:200px;border-top:1px solid #111;padding-top:8px;">公司签章</div>
</div>`;
}

async function loadSelectedFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  await loadPdf(new Uint8Array(buffer), file.name);
}

function createDemoPdfBytes() {
  const encoder = new TextEncoder();
  const streamForPage = (pageNumber) => [
    "0.88 0.92 0.97 rg",
    "50 120 495 620 re f",
    "0 0 0 rg",
    `BT /F1 18 Tf 72 760 Td (PDF Coordinate Demo Page ${pageNumber}) Tj ET`,
    "BT /F1 12 Tf 72 720 Td (Move the mouse. Click to pin a PDF coordinate.) Tj ET",
    "BT /F1 12 Tf 72 180 Td (Person sign area) Tj ET",
    "BT /F1 12 Tf 360 180 Td (Company sign area) Tj ET",
    "0.1 0.4 0.9 RG 1 w",
    "72 170 140 48 re S",
    "360 170 150 48 re S",
  ].join("\n");
  const stream1 = streamForPage(1);
  const stream2 = streamForPage(2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    `<< /Length ${encoder.encode(stream1).length} >>\nstream\n${stream1}\nendstream`,
    `<< /Length ${encoder.encode(stream2).length} >>\nstream\n${stream2}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

els.fileInput.addEventListener("change", () => {
  loadSelectedFile(els.fileInput.files[0]);
});

els.demoButton.addEventListener("click", () => {
  loadPdf(createDemoPdfBytes(), "demo-a4.pdf");
});

els.renderHtmlButton.addEventListener("click", renderHtmlPreview);

els.exportPdfButton.addEventListener("click", exportHtmlPdf);

els.htmlInput.addEventListener("input", () => {
  resetHtmlState();
});

els.sampleHtmlButton.addEventListener("click", () => {
  fillSampleHtml();
  renderHtmlPreview();
});

els.zoomSelect.addEventListener("change", async () => {
  if (currentMode !== "pdf" || !currentBytes) return;
  await loadPdf(currentBytes, currentName);
});

els.precisionSelect.addEventListener("change", () => {
  setActiveCoordinate(activeCoordinate);
  updateMarksList();
});

els.copyButton.addEventListener("click", async () => {
  if (!activeCoordinate) return;
  await navigator.clipboard.writeText(coordinateText(activeCoordinate));
  showToast("坐标已复制");
});

els.clearButton.addEventListener("click", () => {
  marks = [];
  document.querySelectorAll(".crosshair").forEach((node) => node.remove());
  updateMarksList();
});

renderPdf();
updateExportButton();
