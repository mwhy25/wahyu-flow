'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'

function keyLs(provider: string): string {
  switch (provider) {
    case 'hour':   return 'flowboxes.hour.key'
    case 'agnes':  return 'flowboxes.agnes.key'
    case 'openrouter': return 'flowboxes.openrouter.key'
    case 'gemini': return 'flowboxes.google.key'
    case 'huggingface': return 'flowboxes.hf.token'
    case 'pollinations': return 'flowboxes.pollinations.key'
    default: return 'flowboxes.openrouter.key'
  }
}
function getKey(provider: string): string {
  try { return localStorage.getItem(keyLs(provider))||'' } catch { return '' }
}
function setKey(provider: string, v: string): void { try { localStorage.setItem(keyLs(provider), v) } catch {} }

export default function ProviderPage() {
  const { providerName }: { providerName?: string } = useParams() || {}
  const provider = providerName ?? ''
  const [key, setK] = useState(getKey(provider))

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-8">
      <h1 className="mb-6 text-3xl font-bold">
        {provider.replace(/^-/, '').replace(/-/g, ' ')} Provider
      </h1>

      <form className="max-w-md bg-gray-800 p-6 rounded border border-gray-600" onSubmit={(e: React.FormEvent) => {
        e.preventDefault()
        const form = e.currentTarget as HTMLFormElement
        const i = form.querySelector('input[type="password"]') as HTMLInputElement
        setK(i.value)
        setKey(provider, i.value)
        window.location.reload()
      }}>
        <h2 className="mb-4 text-xl font-semibold">API key</h2>
        <input
          type="password"
          className="w-full p-2 border border-gray-500 rounded mb-4"
          placeholder="Paste API key"
          value={key}
          required />
        <button className="w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500">
          Save
        </button>
      </form>

      <p className="mt-6 text-center text-gray-300">
        {key.trim() ? 'key saved' : 'no key – type one above'}
      </p>
    </div>
  )
}