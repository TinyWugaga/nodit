---
id: ADR-004
type: adr
title: 改用 IndexedDB 存放大型專案
status: proposed
date: 2026-10-18
supersedes: [ADR-002]
---

## Context

卡片內容成長後可能逼近 localStorage 上限。

## Decision

評估以 IndexedDB 取代 localStorage。

## Consequences

需處理非同步載入與版本遷移。
