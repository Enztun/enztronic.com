'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Server,
  Container,
  ArrowRight,
  Terminal,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

function CodeBlock({ code, language = 'bash' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group">
      <pre className="bg-black/50 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed border border-border/50">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

interface StepProps {
  number: number;
  title: string;
  children: React.ReactNode;
}

function Step({ number, title, children }: StepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold shrink-0">
          {number}
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="pb-4 space-y-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <div className="text-xs text-muted-foreground leading-relaxed space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SetupGuide() {
  return (
    <div className="space-y-4">
      {/* Ollama Setup */}
      <Card className="py-4">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-sm font-medium">Ollama Setup</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step number={1} title="Install Ollama">
            <p>Download and install Ollama for your platform:</p>
            <CodeBlock code={`# Linux\ncurl -fsSL https://ollama.com/install.sh | sh\n\n# macOS\nbrew install ollama\n\n# Windows — download from https://ollama.com/download`} />
          </Step>

          <Step number={2} title="Pull the LLM Model">
            <p>For optimal performance, use llama3.1:8b. Larger models may be slower:</p>
            <CodeBlock code={`# Recommended model\nollama pull llama3.1:8b\n\n# Alternative: mistral for lower VRAM\nollama pull mistral:7b\n\n# For RX 580 / AMD GPUs with ROCm\n# Set HSA_OVERRIDE_GFX_VERSION before pulling:\nexport HSA_OVERRIDE_GFX_VERSION=10.3.0\nollama pull llama3.1:8b`} />
            <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-md">
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 shrink-0 mt-0.5">
                AMD
              </Badge>
              <span>For RX 580 / AMD GPUs: use ROCm with <code className="bg-black/30 px-1 rounded">HSA_OVERRIDE_GFX_VERSION=10.3.0</code>. On Windows, use DirectML backend with <code className="bg-black/30 px-1 rounded">--gpu dml</code>.</span>
            </div>
          </Step>

          <Step number={3} title="Start Ollama Server">
            <CodeBlock code={`# Start the Ollama server (default port 11434)\nollama serve\n\n# Verify it's running\ncurl http://localhost:11434/api/tags`} />
          </Step>
        </CardContent>
      </Card>

      {/* Docker Setup */}
      <Card className="py-4">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Container className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-sm font-medium">Docker Setup</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step number={1} title="Clone & Configure">
            <CodeBlock code={`git clone https://github.com/meridian-lp/meridian.git\ncd meridian\ncp .env.example .env\n# Edit .env with your private key and RPC endpoint`} />
          </Step>

          <Step number={2} title="Docker Compose">
            <p>Run Meridian with Docker Compose (includes Ollama service):</p>
            <CodeBlock code={`# Start all services\ndocker compose up -d\n\n# View logs\ndocker compose logs -f meridian\n\n# Stop\ndocker compose down`} />
            <p>The <code className="bg-black/30 px-1 rounded">docker-compose.yml</code> includes volume mounts for persistent state:</p>
            <CodeBlock code={`volumes:\n  - ./data:/app/data      # Bot state & memory\n  - ./logs:/app/logs      # Decision logs\n  - ollama:/root/.ollama  # LLM models`} />
          </Step>
        </CardContent>
      </Card>

      {/* Fastify Proxy */}
      <Card className="py-4">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-sm font-medium">Fastify Proxy (Optional)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            If you need to expose the Ollama API on a different port or add CORS headers, use a Fastify proxy:
          </p>
          <CodeBlock code={`// proxy.mjs\nimport Fastify from 'fastify';\nimport fetch from 'node-fetch';\n\nconst app = Fastify();\nconst OLLAMA_URL = 'http://localhost:11434';\n\napp.all('/api/*', async (req, reply) => {\n  const path = req.url.replace('/api', '');\n  const resp = await fetch(\`\${OLLAMA_URL}\${path}\`, {\n    method: req.method,\n    headers: req.headers,\n    body: req.body ? JSON.stringify(req.body) : undefined,\n  });\n  reply.headers(Object.fromEntries(resp.headers.entries()));\n  reply.send(await resp.text());\n});\n\napp.listen({ port: 3030 }, () => {\n  console.log('Ollama proxy on :3030');\n});`} />
          <p className="text-xs text-muted-foreground">
            This is useful when running Meridian in Docker while Ollama runs on the host. Set <code className="bg-black/30 px-1 rounded">LLM_BASE_URL=http://host.docker.internal:3030</code>.
          </p>
        </CardContent>
      </Card>

      {/* First Run */}
      <Card className="py-4">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-sm font-medium">First Run Checklist</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step number={1} title="Set Environment Variables">
            <CodeBlock code={`# Required\nPRIVATE_KEY=your_base58_private_key\nRPC_ENDPOINT=https://api.mainnet-beta.solana.com\n\n# Ollama\nLLM_BASE_URL=http://localhost:11434\nLLM_MODEL=llama3.1:8b\n\n# Safety\nDRY_RUN=true   # Start with dry run!\nMAX_POSITION_SIZE_SOL=1.0`} />
          </Step>

          <Step number={2} title="Start in DRY_RUN Mode">
            <div className="flex items-start gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-md">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-xs">Always start with <code className="bg-black/30 px-1 rounded">DRY_RUN=true</code> to verify the bot&apos;s decisions before committing real SOL.</span>
            </div>
            <CodeBlock code={`# Start the bot\nnode cli.js\n\n# Or with PM2 for production\npm2 start ecosystem.config.cjs`} />
          </Step>

          <Step number={3} title="Monitor the Dashboard">
            <p>Once running, this dashboard will show:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Screening results as pool candidates appear</li>
              <li>Deploy/close decisions in the decision log</li>
              <li>PnL tracking once positions are opened</li>
              <li>Bin range status for each active position</li>
            </ul>
          </Step>

          <Step number={4} title="Go Live">
            <p>After verifying decisions in DRY_RUN mode:</p>
            <CodeBlock code={`# Disable dry run\nDRY_RUN=false\n\n# Increase position size gradually\nMAX_POSITION_SIZE_SOL=2.0`} />
          </Step>
        </CardContent>
      </Card>
    </div>
  );
}
