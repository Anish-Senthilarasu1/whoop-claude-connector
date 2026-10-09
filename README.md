# whoop claude connector

connect your whoop to claude. ask about your sleep, recovery, strain, workouts, and trends without copying anything out of the app.

it runs on your own cloudflare account. one server, one whoop account. the tools only read data.

## setup

[the instructions](instructions.md) are for codex computer use and/or claude computer use. give the agent that file and ask it to set this up for you. you'll still need to sign in and approve access yourself.

if you'd rather do it yourself, follow [manual setup](manual-setup.md).

you'll need a whoop account, a cloudflare account, and a claude account that supports custom connectors.

## try it

- how did i sleep last night?
- how has my recovery changed over the last month?
- compare my strain and sleep this week.

claude will ask before using the tools unless you change its permissions.

## privacy and security

your whoop tokens live in your cloudflare account. data requested through the connector goes to claude. read-only access still includes personal health data, so keep your connector password private.

this is a personal project, not a multi-user service or an independently audited product. [security notes](security.md) explain the protections and the limits.
