# Roadmap

This document outlines planned features, improvements, and long-term vision for the project.

## Upcoming Features

- [ ] Implement full Apps Script deployment flow via /api/setScriptProps
- [ ] Enhance Dashboard UI with visual order table and filtering
- [ ] Add automated label PDF download and email notifications
- [ ] Support multi-user authentication and role-based permissions
- [ ] Integrate additional marketplaces (Shopify, WooCommerce, Amazon MWS)
- [ ] Implement real-time WebSocket updates for order sync status

## Improvements

- Refine error handling and logging throughout backend and **central Apps Script wrapper/library**
- Add robust form validation using React Hook Form + Zod
- Optimize performance for large datasets and pagination
- Improve unit and E2E test coverage
- Add documentation site for API reference and developer guides

## Future Vision

- Offer this as a fully managed SaaS with tenant isolation **(enabled by central script architecture)**
- Provide a marketplace for user-contributed sync scripts
- Build a plugin system for custom marketplaces and carriers
- Incorporate AI-driven automation for exception handling and label optimization 

## Testing

- [x] Manual Testing: Onboarding & Settings (Completed)
- [ ] Manual Testing: Sync Orders & Label Generation
- [ ] Unit Tests: Run `npm test` to validate individual modules
- [ ] E2E Tests: Run `npx cypress open` or `npx cypress run` to validate full user flows 