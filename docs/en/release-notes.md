# Release notes

This file lists every change relevant to people who use or run Go.Data, newest version first. Versions follow the
publication calendar (`YEAR.MONTH.PATCH`) and state the WHO Go.Data version they are based on.

[Português](../pt-BR/notas-de-versao.md)

## 2026.10.0 (WHO base 2.51.0)

Release candidate, under validation. The date of the final release will be announced when it is published.

### Summary

First stable release distributed to state and municipal installations. It is based on WHO Go.Data 2.51.0 and brings
adaptations for surveillance in Brazil: geographic visibility by notification address and by residence chain,
creation of records across municipalities, new address fields, Brazilian date format and a complete Portuguese
translation.

### New

- Geographic visibility configurable per outbreak. Besides the municipality of residence, a team can access cases by
  notification address and the direct contacts of cases living in its area.
- Creation of cases and contacts with an address in another municipality, configurable per outbreak, also when
  creating a single contact.
- Address fields Street, Number, Complement and Neighborhood, enabled per outbreak in the field settings. Values are
  saved and shown on the record form.
- Optional address fields per outbreak and an option to prevent address deletion.
- "Expanded by default" option in the outbreak field settings, so that lists on the record form, such as Documents,
  are open without an extra click.
- Dates and times displayed and exported in the format configured on the server, with an option to export dates
  without time.
- Bulk edit of contact questionnaire answers, configurable per outbreak.
- Location columns by address type in the case, contact and relationship lists, with a location filter by address
  type.
- New columns in the relationship list: classification, date of reporting, date of onset and follow-up team, also
  available in exports.
- Case-insensitive search.
- Contacts and their relationships available through the API, with a "Consulta via API" quick action on the contacts
  page.
- Complete Brazilian Portuguese translation, re-applied on every database update.

### Fixed

- Transmission chains follow the same geographic visibility as the lists.
- Transmission chain filters by location, classification and age range return only the selected records.
- Transmission chains are generated again when a date filter is set.
- Records registered with a notification address only are seen by the teams of the notification location only, no
  longer by every team of the outbreak.
- The follow-up dashboard no longer fails for contacts without a usual place of residence.
- The location list is refreshed right after switching outbreak.
- Outbreaks and templates are no longer replaced by mistake.
- The responsible user filter lists users with access to every outbreak, and the e-mail stays visible next to the
  name.
- Case and contact import maps the responsible user.

### Changed behavior

- The usual place of residence is required for cases and contacts, except in outbreaks configured with optional
  addresses.
- Users with a geographic restriction get access denied when opening records outside their area directly.
- People outside the user's area appear masked in transmission chains, identified by visual ID only, and their names
  are withheld in relationships.
- A user who creates users only sees and grants the permissions they hold. System administrators keep every
  permission and see every outbreak.
- Location is required when creating contacts in group.
- The Portuguese texts of system terms are rewritten on every database update. Translations of those terms
  customized through spreadsheet import are replaced.
- The login page and the side menu show "build 2026.10.0" next to the version.

### Installation and compatibility

- Base: WHO Go.Data 2.51.0.
- Update from any WHO 2.x version installed from source. Database migrations run during the update and cannot be
  undone automatically, so a backup is mandatory.
- Requirements: Node.js 22 LTS and the MongoDB the installation already uses.
- The step by step procedure, with backup and rollback, is in the [Upgrade guide](upgrade.md).
