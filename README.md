# PDF 签章坐标定位

一个基于 Mozilla PDF.js 的轻量 PDF 预览工具，用来确认协议签章坐标。项目已内置 `pdfjs-dist@5.3.31` 的运行文件，不依赖外网 CDN。

## 使用

```bash
python3 -m http.server 5177
```

然后打开：

```text
http://localhost:5177/
```

在页面中选择最终生成的 PDF，鼠标移动会显示当前页的 PDF 坐标：

```text
page=1, x=120, y=180
```

点击 PDF 页面可以固定坐标点，复制后填入协议模板：

```text
personPage / personPoseX / personPoseY
companyPage / companyPoseX / companyPoseY
```

也可以在左侧粘贴协议 HTML，点击“渲染 HTML”后按 A4 页面自动分页预览并显示坐标。HTML 模式用于模板排版阶段快速定位，最终上线前仍建议用实际生成后的 PDF 再校准一次。

## 坐标规则

PDF 坐标原点在页面左下角：

- X 从左往右增大
- Y 从下往上增大
- A4 页面通常约为 595 x 842 point

这个工具显示的是 PDF 坐标，不是浏览器像素坐标。
