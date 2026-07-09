一键启动 HumHum 开发环境。按顺序执行：

1. 检查并清理残留进程（端口 31275 和 1420）
2. 检查 node_modules 是否存在，缺失则 npm install
3. 后台启动 Edge TTS Bridge（python3 scripts/edge-tts-bridge.py），如果 5050 端口已被占用则跳过
4. 后台启动 `npm run tauri dev`
5. 等待前端（localhost:1420）和后端（localhost:31275/health）都就绪
6. 报告启动状态

注意事项：
- tauri dev 和 edge-tts-bridge 都用 run_in_background 在后台运行
- 使用 lsof 检查端口占用判断服务是否已在运行
- 等待就绪时用 curl 轮询，最多等 60 秒
- 如果 edge-tts 的 python 依赖缺失（edge-tts 或 aiohttp），提示用户安装但不阻断启动
