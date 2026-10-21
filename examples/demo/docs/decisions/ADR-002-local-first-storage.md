---
id: ADR-002
type: adr
title: 資料以 local-first 方式存放
status: accepted
date: 2026-10-03
---

## Context

第一階段不做後端，但資料不能因重新整理而遺失。

## Decision

以 localStorage 持久化整份專案，並提供 JSON 匯出／匯入。

## Consequences

單一瀏覽器、無協作；容量上限約 5MB。
