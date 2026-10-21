---
id: ADR-003
type: adr
title: 狀態管理使用 Zustand
status: accepted
date: 2026-10-03
---

## Context

React Flow 官方範例以 Zustand 管理 nodes / edges，與 persist 整合簡單。

## Decision

單一 store 承載專案資料與 UI 狀態。

## Consequences

未來拆多專案時需切 slice。
