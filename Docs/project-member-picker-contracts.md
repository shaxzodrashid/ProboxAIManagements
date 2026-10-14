# Permitted project member discovery — PROJECT 01

GET `/api/v1/projects/:projectId/member-candidates` requires current OPEN account,
`projects.members.manage`, and membership in the project or `projects.manage-all`.
`users.read`, creator identity and workspace role labels grant no alternative
authority. Both guard and transactional service checks use persisted authorization;
every page rechecks it. Archived/deleting projects return409, foreign/missing
projects404. Picker selection grants nothing; existing POST members rechecks target
eligibility and remains idempotent for existing membership.

Approved active employee definition is a current OPEN account belonging to the
workspace. Candidates are therefore only OPEN accounts in this specific project's
workspace. Existing inactive memberships are retained as history, but omitted from
eligible candidate discovery; inactive or moved accounts cannot be newly assigned.

Query contracts: optional literal case-insensitive public name/username `q`
(trimmed, maximum200), `membership=all|members|nonmembers`, validated single
`sort=id|-id|name|-name|username|-username`, `limit` default50/max100, and opaque
`cursor` maximum2048. DefaultidASC preserves deterministic discovery. Text sorting
uses case-insensitive values and idASC ties; missing usernames remain last in either
direction. Membership filter is specific to this project, including the total.
SQL values are parameterized and sort expressions are allowlisted; `%`, `_` and
backslash in search remain literal. Private alias/bio/phone search is unsupported.

Response is exactly `{items,total,nextCursor}`. Item fields are
`{id,displayName,firstName,lastName,username,isMember}`. Display identity reuses the
public profile projection and preserves unsplit legacy names. No role grants,
private contact alias, phone, birth date, bio or external workspace roster appears.
`total` counts the same authorized/filter scope in the same repeatable-read snapshot
as items; it is not a total of all accounts or all historical members. A5second
statement budget and10second transaction budget bound work; failures return503 with
sanitized response. Cursor binds actor/currentworkspace/project/query/filter/sort;
it grants no access. The roster is mutable between requests, so totals/order may
change; it is not a frozen complete-roster guarantee.

No migration, permission grant, full user-directory extension, group invitation,
membership policy change or physical deletion is added. Existing membership
mutation semantics remain independently tested. Real isolated HTTP/database cases
cover permission/scope revocation, inactive/foreign/moved targets, discover→assign,
existing-member flags, literal searches, all six sort modes, filters/scoped counts,
continuation, unknown/injected inputs, exact projection and generated OpenAPI.

Files: three project-member-picker source files, ProjectsModule registration,
`test/project-member-picker.http.spec.ts`, this document and README. Version/evidence
tracking is in the release catalog. Parent owns PROJECT01 checklist status after
the final cumulative verification; this does not complete conversations.
