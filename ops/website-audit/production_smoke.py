#!/usr/bin/env python3
"""Bounded, credential-free GET-only Qianlima behavior checks. No customer data output."""
from html.parser import HTMLParser
import json
import re
import time
import urllib.error
import urllib.request

MAX_BODY = 1024 * 1024


def require(condition, label):
    if not condition:
        raise RuntimeError(label)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.nonces = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.nonces.append(dict(attrs).get('nonce'))


def get(url, spoof=False):
    headers = {'User-Agent': 'Website audit read-only smoke check'}
    if spoof:
        headers['x-nonce'] = 'audit-spoof'
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(
            urllib.request.Request(url, headers=headers, method='GET'), timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        deadline, chunks, size = time.monotonic() + 10, [], 0
        while size <= MAX_BODY:
            require(time.monotonic() < deadline, 'Response body deadline exceeded')
            chunk = getattr(response, 'read1', response.read)(min(8192, MAX_BODY + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        data = b''.join(chunks)
        require(len(data) <= MAX_BODY, 'Response exceeds bounded verification size')
        return response.status, response.headers, data


def verify_page(page, offset):
    require(isinstance(page, dict), 'Public job response is not an object')
    total, jobs = page.get('total'), page.get('jobs')
    require(isinstance(total, int) and not isinstance(total, bool) and total >= 0, 'Invalid public job total')
    require(isinstance(jobs, list) and len(jobs) == min(max(total - offset, 0), 1), 'Invalid public job page size')
    require(all(isinstance(job, dict) and isinstance(job.get('id'), str) and job['id'] for job in jobs), 'Invalid public job identity')
    more = total > offset + 1
    require(page.get('hasMore') is more, 'Invalid public job hasMore')
    require('nextOffset' in page and page['nextOffset'] == (offset + 1 if more else None), 'Invalid public job nextOffset')
    return total, jobs[0]['id'] if jobs else None


def verify_pagination(api, attempts=3):
    # Independent page requests cannot promise a stable catalog. Retry a bounded number of snapshots.
    for _attempt in range(attempts):
        status, _, body = get(api + '/public/jobs?limit=1&offset=0')
        require(status == 200, 'Public job lookup failed')
        try:
            first_total, first_id = verify_page(json.loads(body), 0)
            if first_total <= 1:
                return True
            status, _, body = get(api + '/public/jobs?limit=1&offset=1')
            require(status == 200, 'Second public job lookup failed')
            second_total, second_id = verify_page(json.loads(body), 1)
            if first_total == second_total and first_id != second_id:
                return True
        except (RuntimeError, ValueError, TypeError):
            continue
    raise RuntimeError('Public job pagination could not be verified from a stable bounded sample')


def verify():
    web = 'https://www.qianlima.co.id'
    api = 'https://api.qianlima.co.id'
    nonces = []
    for spoof in [False, True]:
        status, headers, body = get(web + '/dashboard/company', spoof)
        require(status == 200, 'Smoke contract check failed at source line 93')
        policies = headers.get_all('Content-Security-Policy')
        require(policies and len(policies) == 1, 'Smoke contract check failed at source line 95')
        script = next(item.strip() for item in policies[0].split(';') if item.strip().startswith('script-src '))
        require("'strict-dynamic'" in script and "'unsafe-inline'" not in script, 'Smoke contract check failed at source line 97')
        nonce = re.search(r"'nonce-([^']+)'", script).group(1)
        require(nonce != 'audit-spoof', 'Smoke contract check failed at source line 99')
        parser = Scripts()
        parser.feed(body.decode('utf-8'))
        require(parser.nonces and all(value == nonce for value in parser.nonces), 'Smoke contract check failed at source line 102')
        nonces.append(nonce)
    require(nonces[0] != nonces[1], 'Smoke contract check failed at source line 104')
    status, headers, _ = get(web + '/api/cv-preview?profileId=audit-nonexistent')
    require(status == 401 and headers.get('X-Frame-Options') == 'SAMEORIGIN', 'Smoke contract check failed at source line 106')
    require('no-store' in headers.get('Cache-Control', ''), 'Smoke contract check failed at source line 107')
    for path in ['/me', '/cv/audit-nonexistent']:
        require(get(api + path)[0] == 401, 'Smoke contract check failed at source line 109')
    verify_pagination(api)
    return {'matching_rotating_nonce': True, 'nonce_spoof_rejected': True,
            'anonymous_reads_rejected': True, 'cv_preview_headers': True, 'public_pagination': True}


if __name__ == '__main__':
    try:
        print(json.dumps(verify()))
    except Exception as error:
        print(json.dumps({'verification_failed': True, 'error_type': type(error).__name__}))
        raise SystemExit(1)
