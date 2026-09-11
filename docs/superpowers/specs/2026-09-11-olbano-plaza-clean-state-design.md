# Olbano Plaza Clean-State and Navigation Design

## Goal

Start the Rental System with a clean operational dataset while making the main navigation and tenant actions compact and scalable for larger datasets.

## Scope

- Replace inline tenant row actions with a permission-aware dropdown menu.
- Make sidebar sections collapsible, opening the section containing the active route.
- Use `Olbano Plaza` as the visible sidebar and mobile navigation brand.
- Change the seed data to create configuration, floors, and units only.
- Recreate units 1-24 as vacant, preserving the current seeded monthly rents.
- Enable water billing only for units 14-24.
- Clean the current demo transactional data without deleting users or property configuration.

## Data Rules

The unit rent mapping remains the existing mapping: units 1-13 use the current Room rents, units 14 and 19 use the current Bedsitter rents, units 15 and 20 use the current 1 Bedroom rents, units 16-18 and 21-23 use the current Bedsitter rents, and unit 24 uses the current 2 Bedroom rent. No tenant rows are inserted by the seed. All units start `VACANT`; water is enabled when the numeric unit number is between 14 and 24 inclusive.

The cleanup script removes demo tenants and their dependent transactional records, plus seeded water purchases and expenses. It keeps users, settings, branding, properties, floors, and units. It must refuse to delete non-demo operational data unless an explicit cleanup override is supplied.

## UI Behavior

Tenant actions are rendered in one menu trigger per row. The menu exposes only actions allowed by the current role and tenant status, and closes after an action is selected. Sidebar sections use native button controls with `aria-expanded`; the active route automatically expands its section while users can collapse or reopen sections.

## Performance and Verification

Existing paginated API requests remain bounded. Tenant and unit lists continue to refresh only when filters or mutations change. Verification includes frontend and backend typechecks, focused backend tests for water/unit business rules, and a seed/cleanup SQL review for the clean-state invariants.