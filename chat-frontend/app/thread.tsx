"use client";

import { ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from "@assistant-ui/react";

/**
 * Minimal chat thread built from assistant-ui primitives. Inline-styled with
 * the OpenSearch palette so it needs no Tailwind/CSS framework, keeping the
 * static build lean. The AG-UI runtime (from `useAgUiRuntime`) drives it.
 */
export function Thread() {
  return (
    <ThreadPrimitive.Root
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#ffffff",
      }}
    >
      <header
        style={{
          backgroundColor: "#003b5c",
          color: "#ffffff",
          padding: "12px 20px",
          fontWeight: 600,
          fontSize: "1rem",
        }}
      >
        Retail Assistant
      </header>

      <ThreadPrimitive.Viewport
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <ThreadPrimitive.Empty>
          <div style={{ color: "#5b6b7b", textAlign: "center", marginTop: "2rem" }}>
            Hi! I&apos;m your retail assistant. How can I help you today?
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />
      </ThreadPrimitive.Viewport>

      <Composer />
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root
      style={{ display: "flex", justifyContent: "flex-end" }}
    >
      <div
        style={{
          backgroundColor: "#005eb8",
          color: "#ffffff",
          borderRadius: "12px",
          padding: "10px 14px",
          maxWidth: "75%",
          whiteSpace: "pre-wrap",
        }}
      >
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      style={{ display: "flex", justifyContent: "flex-start" }}
    >
      <div
        style={{
          backgroundColor: "#f4f6f9",
          color: "#1a1a2e",
          borderRadius: "12px",
          padding: "10px 14px",
          maxWidth: "75%",
          whiteSpace: "pre-wrap",
        }}
      >
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root
      style={{
        display: "flex",
        gap: "8px",
        padding: "16px 20px",
        borderTop: "1px solid #d1d9e0",
        backgroundColor: "#ffffff",
      }}
    >
      <ComposerPrimitive.Input
        placeholder="Ask about products, inventory, or your cart…"
        style={{
          flex: 1,
          resize: "none",
          border: "1px solid #d1d9e0",
          borderRadius: "8px",
          padding: "10px 12px",
          fontSize: "0.95rem",
          outlineColor: "#005eb8",
          fontFamily: "inherit",
        }}
      />
      <ComposerPrimitive.Send
        style={{
          backgroundColor: "#005eb8",
          color: "#ffffff",
          border: "none",
          borderRadius: "8px",
          padding: "0 18px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Send
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
