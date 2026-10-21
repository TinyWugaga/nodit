---
id: ADR-001
type: adr
title: 以 React Flow 作為 canvas 引擎
status: accepted
date: 2026-10-01
---

## Context

需要可拖曳、可縮放、可自訂節點的 node-graph，且要能長期維護。

## Decision

採用 @xyflow/react v12，節點與連線皆用自訂元件。

## Consequences

綁定 React 生態；大量節點時需留意 re-render。
