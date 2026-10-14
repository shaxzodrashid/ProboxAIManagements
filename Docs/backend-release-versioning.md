# Backend release provenance

`package.json.version` is the single current release version. Semantic releases
use `major.minor.patch`; dev checkpoints use `major.minor.patch-dev.N` on dev.
Production main changes receive an explicitly selected stable release version.
An incomplete umbrella may have a sound bounded contract in a dev checkpoint;
its catalog state remains foundation. Version/tag presence does not mean deployed.

The baseline is the actual package0.1.0 snapshot at commit
`31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. Legacy introduction history is unknown.
No earlier feature versions, tags or release dates are inferred.

For a release, update package version, add a CHANGELOG section and catalog release
reference. Add new bounded features with their first tracked `since` version and
real contract evidence; preserve existing introduction versions. Run
`pnpm release:docs` and review generated feature availability. The actual precommit
hook runs `pnpm release:check`; stale docs or inconsistent metadata fail the hook.
After all checks and commit, create an annotated `vVERSION` tag at that commit.
Run `pnpm release:check -- --published` to verify provenance, then push dev and its
new tag without overwriting any existing tag. Future tags remain immutable.

Concrete example: permitted project member discovery is **Available since
0.2.0-dev.1**, resolving through `refs/tags/v0.2.0-dev.1` to the implementation
commit. Group metadata has the same version and foundation scope; it does not mean
that invitations or usable chat are implemented. Neither means production support
until a stable main release is explicitly deployed and verified by its operator.

Swagger `info.version` uses the package release version. API compatibility remains
`/api/v1`; a release number is not a reason to introduce `/v2`. No private commit,
build environment, filesystem path or credential is exposed by version metadata.
