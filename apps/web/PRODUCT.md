# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

React client packaged with Capacitor for iOS and Android; no public web platform is in scope.

## Users

Groups organizing and documenting shared trips.

## Product Purpose

Consult transport, activities, posts and expenses in a daily itinerary.

## Capabilities and Constraints

The source of product truth is [PRD v1](../../docs/versiones/v1/PRD.md), with architecture constraints in [AGENTS.md](../../AGENTS.md).
T34 extends the existing client interface and reuses its components and authenticated aggregate API.
Instants are stored in UTC and displayed in the user's local timezone; canonical itinerary references remain unchanged.
Posts, expenses and relationships must not be duplicated by calendar presentation.
