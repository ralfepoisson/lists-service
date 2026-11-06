"""Explicit Calendar release-only single-owner acceptance with a disposable sentinel.

This proves the supplied principal cannot read/write another DB namespace. It
DOES NOT prove a second principal's current login or positive owning access.
Default release acceptance continues to require two genuine fresh tenant JWTs.
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import time
import uuid
from contextlib import contextmanager
from urllib.parse import unquote, urlsplit

PROFILE = 'calendar-owner-sentinel/v1'
AUTHORITY = 'Todoist:6hwGJ9CxJHj6Fg3R:6hwRG3hM6hqCHMQR'


def validate_contract(value, claims, *, now=None):
    now=time.time() if now is None else now
    if (set(value) != {'schemaVersion','authorityRef','accountId','subject','expiresAt'}
        or value['schemaVersion'] != PROFILE or value['authorityRef'] != AUTHORITY
        or not isinstance(value['accountId'],str) or not value['accountId']
        or not isinstance(value['subject'],str) or not value['subject']
        or value['accountId'] != claims.get('accountId') or value['subject'] != claims.get('sub')
        or type(value['expiresAt']) is not int or not now < value['expiresAt'] <= now+86400):
        raise ValueError('Calendar release acceptance contract differs')
    return dict(value)


def new_sentinel():
    identity=str(uuid.uuid4())
    return {'id':identity,'namespace':'calendar-release-sentinel:'+identity,
            'subject':'disposable-fixture-not-an-auth-principal',
            'title':'DISPOSABLE Calendar release isolation sentinel '+identity,
            'outcome':'Non-customer fixture; no Auth principal; remove only exact unchanged provenance',
            'status':'closed'}


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'))


def literal(value):
    return "'"+value.replace("'","''")+"'"


def _sql(environment, statement, *, psql="/usr/bin/psql"):
    result=subprocess.run([psql,'-X','-Atq','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,env=environment,timeout=30)
    if result.returncode:
        raise ValueError('sentinel database operation failed; exact provenance retained')
    lines=result.stdout.strip().splitlines()
    return json.loads(lines[-1]) if lines else None


def environment_for(migration_values):
    uri=urlsplit(migration_values['DATABASE_URL'])
    if uri.scheme!='postgresql' or uri.hostname!='postgres' or uri.port!=5432 or uri.path!='/lists_service':
        raise ValueError('sentinel only supports maintained Lists database')
    return {**os.environ,'PGHOST':'127.0.0.1','PGPORT':'5432','PGDATABASE':'lists_service','PGUSER':unquote(uri.username),'PGPASSWORD':unquote(uri.password),'PGCONNECT_TIMEOUT':'5'}


@contextmanager
def _fixture(environment, release, *, psql="/usr/bin/psql"):
    """Persist intent BEFORE insertion; refuse any changed fixture at cleanup."""
    value=new_sentinel()
    ledger=pathlib.Path(release)/('sentinel-'+value['id']+'.json')
    record={'schemaVersion':PROFILE,'fixture':value,'state':'intent','limitations':'No second owning-principal positive login/read is proven'}
    def save():
        temporary=ledger.with_suffix('.tmp')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as stream:
            stream.write(canonical(record)+'\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,ledger)
    save()
    ident=literal(value['id']);namespace=literal(value['namespace'])
    # No existing namespace is adopted; the closed record has no foreign keys to
    # customer content and its subject is explicitly not an identity/token.
    insert="""BEGIN;
SELECT pg_advisory_xact_lock(73251124369);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM loops WHERE account_id=%s OR id=%s) THEN RAISE EXCEPTION 'sentinel collision'; END IF; END $$;
INSERT INTO loops(id,account_id,title,outcome,status,created_by_sub,updated_by_sub,created_at,updated_at,closed_at)
VALUES(%s,%s,%s,%s,'closed',%s,%s,clock_timestamp(),clock_timestamp(),clock_timestamp());
SELECT row_to_json(l) FROM loops l WHERE id=%s AND account_id=%s;
COMMIT;""" % (namespace,ident,ident,namespace,literal(value['title']),literal(value['outcome']),literal(value['subject']),literal(value['subject']),ident,namespace)
    row=_sql(environment,insert,psql=psql)
    if not isinstance(row,dict) or row.get('id')!=value['id'] or row.get('account_id')!=value['namespace']:
        raise ValueError('sentinel receipt missing; retained intent requires exact reconciliation')
    record.update(state='inserted',row=row,rowSha256=hashlib.sha256(canonical(row).encode()).hexdigest());save()
    try:
        yield value,record
    finally:
        # Lock and compare the COMPLETE row, including version/timestamps. No
        # cascade deletion is allowed if any related record/comment/receipt exists.
        expected=literal(canonical(row))
        cleanup="""BEGIN;
SELECT pg_advisory_xact_lock(73251124369);
SELECT 1 FROM loops WHERE id=%s AND account_id=%s FOR UPDATE;
DO $$ BEGIN
IF (SELECT to_jsonb(l) FROM loops l WHERE id=%s AND account_id=%s) IS DISTINCT FROM %s::jsonb
OR EXISTS(SELECT 1 FROM loop_related_records WHERE loop_id=%s)
OR EXISTS(SELECT 1 FROM loop_comments WHERE loop_id=%s)
OR EXISTS(SELECT 1 FROM loop_append_operations WHERE loop_id=%s)
THEN RAISE EXCEPTION 'sentinel changed: refuse cleanup'; END IF;
END $$;
DELETE FROM loops WHERE id=%s AND account_id=%s;
SELECT json_build_object('remaining',(SELECT count(*) FROM loops WHERE id=%s OR account_id=%s));
COMMIT;""" % (ident,namespace,ident,namespace,expected,ident,ident,ident,ident,namespace,ident,namespace)
        result=_sql(environment,cleanup,psql=psql)
        if result!={'remaining':0}:
            raise ValueError('sentinel cleanup not verified')
        record.update(state='deleted-verified',cleanup=result);save()


def negative_http(base, primary, sentinel_id):
    from candidate_smoke import _expect,_request
    if str(uuid.UUID(sentinel_id)) != sentinel_id:
        raise ValueError('invalid exact sentinel identity')
    path='/v1/loops/'+sentinel_id
    _expect(*_request(base,path,token=primary),404)
    _expect(*_request(base,path,method='PATCH',token=primary,payload={'outcome':'Must remain inaccessible'}),404)
    _expect(*_request(base,path+'/comments',token=primary),404)
    _expect(*_request(base,path+'/comments',method='POST',token=primary,payload={'content':'Must remain inaccessible'}),404)


def checked_contract(shared, primary):
    from host_candidate import _trusted_file
    path=pathlib.Path(shared)/'calendar-owner-acceptance.json'
    _trusted_file(path,0o600)
    raw=path.read_bytes()
    if len(raw)>4096:
        raise ValueError('oversized Calendar acceptance contract')
    body=primary.split('.')[1]
    claims=json.loads(base64.urlsafe_b64decode(body+'='*(-len(body)%4)))
    return validate_contract(json.loads(raw),claims)


@contextmanager
def acceptance_context(shared, release, migration_values, base, *, enabled, expected_revision, expected_version):
    if not enabled:
        yield None
        return
    from candidate_smoke import load_token,_request,_expect
    primary=load_token(pathlib.Path(shared)/'smoke-primary.jwt')
    checked_contract(shared,primary)
    if base not in ('http://127.0.0.1:43240','http://127.0.0.1:43241','https://lists.life-sqrd.com'):
        raise ValueError('Calendar acceptance requires fixed candidate/public origin')
    served=_expect(*_request(base,'/version'),200)
    if served.get('version') != expected_version or served.get('revision') != expected_revision:
        raise ValueError('sentinel requires exact qualified served identity')
    # Real service must verify the normal token/current membership before any
    # fixture is created. The decoded contract above is never auth authority.
    _expect(*_request(base,'/v1/loops',token=primary),200)
    with fixture(migration_values,release) as (sentinel,record):
        yield {'profile':PROFILE,'id':sentinel['id']}


@contextmanager
def fixture(migration_values, release):
    with _fixture(environment_for(migration_values),release) as value:
        yield value
