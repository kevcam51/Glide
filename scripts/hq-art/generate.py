# Image generation through the Responses API in BACKGROUND mode: the job runs on
# OpenAI's side and we poll with short requests, so no connection has to stay
# open for the minute or two a high-quality render takes. Reads OPENAI_API_KEY
# from the environment and never prints it.
import base64, json, os, sys, time, urllib.request, argparse

p = argparse.ArgumentParser()
p.add_argument("--prompt-file", required=True)
p.add_argument("--out", required=True)
p.add_argument("--image-model", default="gpt-image-2")
p.add_argument("--model", default="gpt-5.4")
p.add_argument("--size", default="1536x1024")
p.add_argument("--quality", default="high")
p.add_argument("--background", default=None)
p.add_argument("--ref", action="append", default=[])
a = p.parse_args()
key = os.environ.get("OPENAI_API_KEY", "")
if not key:
    print("no key"); sys.exit(2)
prompt = open(a.prompt_file).read().strip()

def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:800]); sys.exit(1)

content = [{"type": "input_text", "text":
    "Generate exactly one image with the image generation tool, using the brief below verbatim "
    "as the image prompt. Do not shorten or reinterpret it.\n\n" + prompt}]
for r in a.ref:
    mime = "image/png" if r.endswith(".png") else ("image/webp" if r.endswith(".webp") else "image/jpeg")
    content.append({"type": "input_image",
                    "image_url": f"data:{mime};base64," + base64.b64encode(open(r, "rb").read()).decode()})
tool = {"type": "image_generation", "model": a.image_model, "size": a.size, "quality": a.quality}
if a.background: tool["background"] = a.background
body = {"model": a.model, "background": True, "store": True,
        "input": [{"role": "user", "content": content}],
        "tools": [tool], "tool_choice": {"type": "image_generation"}}
t0 = time.time()
r = call("POST", "https://api.openai.com/v1/responses", body)
rid = r.get("id")
print("queued", rid, r.get("status"), flush=True)
while True:
    time.sleep(5)
    r = call("GET", f"https://api.openai.com/v1/responses/{rid}")
    st = r.get("status")
    if st in ("completed", "failed", "cancelled", "incomplete"):
        break
if st != "completed":
    print("status", st, json.dumps(r.get("error") or r.get("incomplete_details"))[:600]); sys.exit(1)
img = None
for item in r.get("output", []):
    if item.get("type") == "image_generation_call" and item.get("result"):
        img = item["result"]
        rp = item.get("revised_prompt")
if not img:
    print("no image in output"); sys.exit(1)
open(a.out, "wb").write(base64.b64decode(img))
print(json.dumps({"saved": a.out, "secs": round(time.time() - t0, 1), "usage": r.get("usage")}))
