# 小豆邀请码站 · V1.0 首页源码

开发依据：`文档/小豆邀请码站-UIUX设计方案-v1.3.md`。本源码只实现一期首页，不含自动采集、后台、登录、注册、用户提交、付费功能。

## 目录

- `index.html`：首页结构
- `styles.css`：V1.3 设计 Token 与响应式布局
- `app.js`：数据读取、缓存、复制、本机标记、搜索筛选排序、统计
- `data/codes.json`：DEMO 示例数据，全部条目带 `DEMO` 标记
- `data/codes.empty.json`：空数据测试文件
- `.nojekyll`：GitHub Pages 静态发布标记
- `交付报告.md`：测试结果、未完成项和文件清单

## 本地运行

不要直接双击 `index.html`。`fetch` 读取 JSON 和剪贴板 API 需要 http(s) 环境。

在本目录打开 PowerShell，执行下面这条命令（不依赖 Python，也不用安装任何包）：

```powershell
node -e "const http=require('http'),fs=require('fs'),path=require('path');http.createServer((q,s)=>{let p=q.url.split('?')[0];if(p==='/')p='/index.html';const f=path.join(process.cwd(),p);fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'Content-Type':({'html':'text/html','css':'text/css','js':'text/javascript','json':'application/json'}[p.split('.').pop()]||'text/plain')+'; charset=utf-8'});s.end(d)})}).listen(8000,()=>console.log('ready'))"
```

然后浏览器访问：

```text
http://localhost:8000/
```

也可以用 VS Code 的 Live Server 插件打开 `index.html`。如果本机有可用的 Python，也可用 `python -m http.server 8000`。

## 切换测试数据

- 默认：`http://localhost:8000/`
- 空数据：`http://localhost:8000/?data=data/codes.empty.json`

只允许切换本目录内的 `.json` 文件；不能在 URL 里填外部地址。

## 数据发布

一期由人工整理 `data/codes.json`，改完提交/上传到静态托管即可。前端「刷新数据」只读这个已发布文件，不触发任何平台抓取。

关键字段：

- `status`：只能是 `available` 或 `used_uncertain`
- `first_collected_at`：首次收录时间；无法确定填 `null`，不计入今日新增和 15 分钟内新码
- `is_demo`：示例数据填 `true`，页面会显示 DEMO 标记
- `post_url`：只接受 `http(s)` 链接，点击来源在新窗口打开

## 访问人数

统计卡里的「今日访问人数」和「总访问人数」是按用户要求在 2026-11-26 新增的**模拟占位数据**，当前值分别为 `128` 和 `4096`，页面用「模拟」标签标明。

这两项没有接入任何统计服务、Cookie、服务器接口或后台，不代表真实访问量。

## 一期没有做

- 五平台自动采集、付费 API、服务器接口
- 后台管理、人工审核界面、用户提交入口
- 自动后台轮询、失败后自动连续重试
- 屏幕阅读器检查、系统无障碍审计
- 真实邀请码数据（当前只有 DEMO，未提供真实数据源）

这些项没有做就是没有做，不能在验收里写成通过。
