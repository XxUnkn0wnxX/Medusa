# coding=utf-8
"""Regression tests for /history episode-title and release filtering."""
from __future__ import unicode_literals

import json
import sqlite3
from types import SimpleNamespace
from urllib.parse import parse_qsl, urlencode

from medusa.common import DOWNLOADED, FAILED, Quality, SNATCHED
from medusa.server.api.v2 import history as history_module
from medusa.tv.series import Series

import pytest


def _fake_find_by_identifier(identifier, predicate):
    titles = {(1, 101): 'My English Title'}
    title = titles.get((identifier.indexer.id, identifier.id))
    if not title:
        return None
    show = SimpleNamespace(title=title)
    if predicate and not predicate(show):
        return None
    return show


def _history_url(create_url, resource_filter=None, column_filters=None, compact=False, page=None, limit=None, sort=None):
    base_url = create_url('/history')
    base, _, query = base_url.partition('?')

    query_params = dict(parse_qsl(query))
    filters = {}
    if resource_filter is not None:
        filters['resource'] = resource_filter
    if column_filters:
        filters.update(column_filters)
    query_params['filter'] = json.dumps({'columnFilters': filters}, separators=(',', ':'))
    if compact:
        query_params['compact'] = 1
    if page is not None:
        query_params['page'] = page
    if limit is not None:
        query_params['limit'] = limit
    if sort is not None:
        query_params['sort'] = json.dumps(sort, separators=(',', ':'))

    return '{0}?{1}'.format(base, urlencode(query_params))


def _insert_history_row(connection, action, resource, indexer_id=1, showid=101, season=1, episode=1,
                        provider='UnitProvider', quality=0, size=1, client_status=None, date=1):
    connection.execute(
        'INSERT INTO history (date, action, quality, provider, version, resource, size, proper_tags, indexer_id, showid, '
        'season, episode, manually_searched, info_hash, provider_type, client_status, part_of_batch) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (
            date,
            action,
            quality,
            provider,
            'unit',
            resource,
            size,
            '',
            indexer_id,
            showid,
            season,
            episode,
            0,
            '',
            '',
            client_status,
            0,
        )
    )
    return connection.execute('SELECT last_insert_rowid()').fetchone()[0]


@pytest.fixture
def history_db(monkeypatch):
    connection = sqlite3.connect(':memory:', check_same_thread=False)
    connection.row_factory = sqlite3.Row

    class SharedMemoryDBConnection(object):
        def __init__(self, *_args, **_kwargs):
            self.connection = connection

        @property
        def path(self):
            return ':memory:'

        def action(self, query, args=None, fetchall=False, fetchone=False):
            cursor = self.connection.cursor()
            cursor.execute(query, args or [])
            if fetchall:
                return [dict(row) for row in cursor.fetchall()]
            if fetchone:
                row = cursor.fetchone()
                return dict(row) if row else None
            return None

        def select(self, query, args=None):
            return self.action(query, args, fetchall=True) or []

        def close(self):
            return None

    monkeypatch.setattr(history_module.db, 'DBConnection', SharedMemoryDBConnection)
    monkeypatch.setattr(
        Series,
        'find_by_identifier',
        classmethod(lambda _cls, identifier, predicate=None: _fake_find_by_identifier(identifier, predicate))
    )

    connection.execute(
        'CREATE TABLE history ('
        'date INTEGER, action INTEGER, quality INTEGER, provider TEXT, version TEXT, resource TEXT, '
        'size INTEGER, proper_tags TEXT, indexer_id INTEGER, showid INTEGER, season INTEGER, episode INTEGER, '
        'manually_searched INTEGER, info_hash TEXT, provider_type TEXT, client_status INTEGER, part_of_batch INTEGER)'
    )
    connection.execute('CREATE TABLE tv_shows (indexer INTEGER, indexer_id INTEGER, show_name TEXT)')
    connection.execute('CREATE TABLE scene_exceptions (indexer INTEGER, series_id INTEGER, title TEXT)')
    connection.commit()

    connection.execute('INSERT INTO tv_shows (indexer, indexer_id, show_name) VALUES (?, ?, ?)', (1, 101, 'My English Title'))
    connection.execute('INSERT INTO scene_exceptions (indexer, series_id, title) VALUES (?, ?, ?)', (1, 101, 'Romaji Scene Title'))
    connection.execute('INSERT INTO scene_exceptions (indexer, series_id, title) VALUES (?, ?, ?)', (1, 101, '日本語の別名'))
    connection.execute('INSERT INTO scene_exceptions (indexer, series_id, title) VALUES (?, ?, ?)', (1, 101, "Hero's Alternate Title"))
    connection.commit()

    yield connection
    connection.close()


@pytest.fixture
def fetch_history(http_client, create_url, auth_headers):
    async def _fetch(resource=None, **query_params):
        response = await http_client.fetch(_history_url(create_url, resource, **query_params), **auth_headers)
        return response

    return _fetch


@pytest.mark.gen_test
@pytest.mark.parametrize('resource_filter', ['My English Title', 'English'])
async def test_resource_filter_exact_and_partial_english_title(history_db, fetch_history, resource_filter):
    row_id = _insert_history_row(history_db, DOWNLOADED, 'release_one.mkv')
    response = await fetch_history(resource_filter)
    rows = json.loads(response.body)

    assert response.code == 200
    assert {row['id'] for row in rows} == {row_id}


@pytest.mark.gen_test
@pytest.mark.parametrize('resource_filter', ['my english title', 'MY ENGLISH TITLE', 'mY EnGlIsH tItLe'])
async def test_resource_filter_case_variants(history_db, fetch_history, resource_filter):
    history_db.execute('PRAGMA case_sensitive_like = ON')
    row_id = _insert_history_row(history_db, DOWNLOADED, 'release_two.mkv')
    response = await fetch_history(resource_filter)
    rows = json.loads(response.body)

    assert response.code == 200
    assert {row['id'] for row in rows} == {row_id}


@pytest.mark.gen_test
@pytest.mark.parametrize(
    'resource_filter',
    [
        'Romaji Scene Title',
        'Scene Title',
        'romaji scene title',
        'ROMAJI SCENE TITLE',
        'Romaji SCENE title',
        '日本語の別名',
        "Hero's Alternate Title",
    ]
)
async def test_resource_filter_scene_alias_exact_and_partial(history_db, fetch_history, resource_filter):
    history_db.execute('PRAGMA case_sensitive_like = ON')
    row_id = _insert_history_row(history_db, DOWNLOADED, 'release_three.mkv')
    response = await fetch_history(resource_filter)
    rows = json.loads(response.body)

    assert response.code == 200
    assert {row['id'] for row in rows} == {row_id}


@pytest.mark.gen_test
async def test_english_and_alias_query_return_identical_rows(history_db, fetch_history):
    english_row = _insert_history_row(history_db, DOWNLOADED, 'episode_one.mkv')
    alias_resource_row = _insert_history_row(history_db, SNATCHED, 'mixed-release.bin')

    english_rows = json.loads((await fetch_history('My English Title')).body)
    alias_rows = json.loads((await fetch_history('Romaji Scene Title')).body)

    assert {row['id'] for row in english_rows} == {english_row, alias_resource_row}
    assert {row['id'] for row in alias_rows} == {english_row, alias_resource_row}


@pytest.mark.gen_test
@pytest.mark.parametrize(
    'resource_filter',
    ['My English Title - s01e05', 'Romaji Scene Title - s01e05', 'my english title - S01E05']
)
async def test_rendered_episode_filter_targets_only_matching_episode(history_db, fetch_history, resource_filter):
    matching_snatched = _insert_history_row(history_db, SNATCHED, 's01e05_snatched.mkv', episode=5)
    matching_downloaded = _insert_history_row(history_db, DOWNLOADED, 's01e05_downloaded.mkv', episode=5)
    _insert_history_row(history_db, FAILED, 's01e06_failed.mkv', episode=6)

    rows = json.loads((await fetch_history(resource_filter)).body)

    assert {row['id'] for row in rows} == {matching_snatched, matching_downloaded}
    assert {row['status'] for row in rows} == {SNATCHED, DOWNLOADED}
    assert all(row['episode'] == 5 for row in rows)


@pytest.mark.gen_test
async def test_multiple_aliases_for_same_identity_do_not_duplicate_rows(history_db, fetch_history):
    history_db.execute('INSERT INTO scene_exceptions (indexer, series_id, title) VALUES (?, ?, ?)', (1, 101, 'Romaji Alternative'))
    history_db.commit()

    row_id = _insert_history_row(history_db, DOWNLOADED, 'alias_release.mkv')
    response = await fetch_history('Scene')
    rows = json.loads(response.body)

    assert response.code == 200
    assert {row['id'] for row in rows} == {row_id}


@pytest.mark.gen_test
@pytest.mark.parametrize('resource_filter', ['OnlyResourceMatch', 'ResourceMatch', 'onlyresourcematch'])
async def test_direct_resource_filter_stays_row_local(history_db, fetch_history, resource_filter):
    history_db.execute('PRAGMA case_sensitive_like = ON')
    targeted = _insert_history_row(history_db, DOWNLOADED, 'OnlyResourceMatch.mkv')
    _insert_history_row(history_db, SNATCHED, 'OtherResource.mkv')

    rows = json.loads((await fetch_history(resource_filter)).body)

    assert {row['id'] for row in rows} == {targeted}


@pytest.mark.gen_test
async def test_orphan_history_rows_are_directly_searchable(history_db, fetch_history):
    orphan_row = _insert_history_row(history_db, DOWNLOADED, 'OrphanResource.mkv', indexer_id=None, showid=None)
    _insert_history_row(history_db, DOWNLOADED, 'OtherResource.mkv')

    rows = json.loads((await fetch_history('OrphanResource')).body)

    assert {row['id'] for row in rows} == {orphan_row}


@pytest.mark.gen_test
async def test_unrelated_column_matches_do_not_satisfy_episode_filter(history_db, fetch_history):
    provider_only_row = _insert_history_row(
        history_db,
        DOWNLOADED,
        'ProviderResource.mkv',
    )
    # update provider to keep test term out of the resource/identity fields.
    history_db.execute('UPDATE history SET provider = ? WHERE rowid = ?', ('ProviderOnlySearchKey', provider_only_row))
    history_db.commit()

    response = await fetch_history('ProviderOnlySearchKey')
    rows = json.loads(response.body)

    assert response.code == 200
    assert rows == []


@pytest.mark.gen_test
@pytest.mark.parametrize('resource_filter', ['My English Title', 'Romaji Scene Title'])
async def test_episode_title_and_status_filter_are_combined_as_and(history_db, fetch_history, resource_filter):
    downloaded_row_id = _insert_history_row(history_db, DOWNLOADED, 'status-match-download.mkv')
    _insert_history_row(history_db, SNATCHED, 'status-match-snatched.mkv')

    rows = json.loads((await fetch_history(resource_filter, column_filters={'statusName': DOWNLOADED})).body)

    assert {row['id'] for row in rows} == {downloaded_row_id}


@pytest.mark.gen_test
async def test_episode_filter_with_provider_is_case_insensitive_and_partial(history_db, fetch_history):
    matching_row = _insert_history_row(
        history_db,
        DOWNLOADED,
        'provider-match.mkv',
        provider='Unit Provider Alpha'
    )
    _insert_history_row(
        history_db,
        DOWNLOADED,
        'provider-no-match.mkv',
        provider='External Source'
    )

    rows = json.loads((await fetch_history('My English Title', column_filters={'providerId': 'unit provider'})).body)

    assert {row['id'] for row in rows} == {matching_row}


@pytest.mark.gen_test
async def test_episode_filter_with_quality_size_and_client_status_filters_stacks(history_db, fetch_history):
    match_row = _insert_history_row(
        history_db,
        SNATCHED,
        'stack-match.mkv',
        quality=Quality.HDTV,
        size=8 * 1024 * 1024,
        client_status=3,
        episode=10
    )
    _insert_history_row(
        history_db,
        SNATCHED,
        'stack-size-miss.mkv',
        quality=Quality.HDTV,
        size=2 * 1024 * 1024,
        client_status=3,
        episode=10
    )
    _insert_history_row(
        history_db,
        SNATCHED,
        'stack-quality-miss.mkv',
        quality=Quality.FULLHDTV,
        size=8 * 1024 * 1024,
        client_status=3,
        episode=10
    )
    _insert_history_row(
        history_db,
        SNATCHED,
        'stack-clientstatus-miss.mkv',
        quality=Quality.HDTV,
        size=8 * 1024 * 1024,
        client_status=7,
        episode=10
    )

    rows = json.loads((
        await fetch_history(
            'My English Title',
            column_filters={'quality': Quality.HDTV, 'size': '> 4', 'clientStatus': 3}
        )
    ).body)

    assert {row['id'] for row in rows} == {match_row}


@pytest.mark.gen_test
async def test_request_filter_state_is_scoped_by_request(history_db, fetch_history):
    provider_one_row = _insert_history_row(
        history_db,
        DOWNLOADED,
        'provider-one.mkv',
        provider='ProviderOne'
    )
    provider_two_row = _insert_history_row(
        history_db,
        DOWNLOADED,
        'provider-two.mkv',
        provider='ProviderTwo'
    )

    first_request = json.loads((await fetch_history('My English Title', column_filters={'providerId': 'providerone'})).body)
    second_request = json.loads((await fetch_history('My English Title', column_filters={'providerId': 'providertwo'})).body)

    assert {row['id'] for row in first_request} == {provider_one_row}
    assert {row['id'] for row in second_request} == {provider_two_row}


@pytest.mark.gen_test
async def test_compact_mode_groups_episode_by_identity_and_keeps_snatched_downloaded_together(history_db, fetch_history):
    snatched_row = _insert_history_row(
        history_db,
        SNATCHED,
        'compact-s01e01-snatched.mkv',
        quality=Quality.HDTV,
        episode=1
    )
    downloaded_row = _insert_history_row(
        history_db,
        DOWNLOADED,
        'compact-s01e01-downloaded.mkv',
        quality=Quality.HDTV,
        episode=1
    )

    canonical_response = await fetch_history('My English Title', compact=True)
    alias_response = await fetch_history('Romaji Scene Title', compact=True)
    canonical = json.loads(canonical_response.body)
    alias = json.loads(alias_response.body)

    assert len(canonical) == 1
    assert len(alias) == 1
    assert canonical_response.headers['X-Pagination-Count'] == '1'
    assert alias_response.headers['X-Pagination-Count'] == '1'
    assert canonical[0]['rows'][0]['statusName'] in {'Snatched', 'Downloaded'}
    assert {row['statusName'] for row in canonical[0]['rows']} == {'Snatched', 'Downloaded'}
    assert {row['id'] for row in canonical[0]['rows']} == {snatched_row, downloaded_row}
    assert {row['id'] for row in alias[0]['rows']} == {snatched_row, downloaded_row}
    assert canonical[0]['episodeTitle'] == 'My English Title - s01e01'


@pytest.mark.gen_test
@pytest.mark.parametrize('resource_filter', ['My English Title - s01e05', 'Romaji Scene Title - s01e05'])
async def test_rendered_episode_filter_in_compact_mode_targets_exact_episode(history_db, fetch_history, resource_filter):
    target_row = _insert_history_row(history_db, DOWNLOADED, 'compact-ep-05.mkv', episode=5, quality=Quality.HDTV)
    _insert_history_row(history_db, DOWNLOADED, 'compact-ep-06.mkv', episode=6, quality=Quality.HDTV)

    compact_rows = json.loads((await fetch_history(resource_filter, compact=True)).body)

    assert len(compact_rows) == 1
    assert compact_rows[0]['episodeTitle'] == 'My English Title - s01e05'
    assert {row['id'] for row in compact_rows[0]['rows']} == {target_row}


@pytest.mark.gen_test
async def test_detailed_pagination_with_title_filter_uses_total_row_count(history_db, fetch_history):
    inserted = [
        _insert_history_row(history_db, DOWNLOADED, 'detailed-ep-01.mkv', episode=1, date=11),
        _insert_history_row(history_db, DOWNLOADED, 'detailed-ep-02.mkv', episode=2, date=12),
        _insert_history_row(history_db, DOWNLOADED, 'detailed-ep-03.mkv', episode=3, date=13),
        _insert_history_row(history_db, DOWNLOADED, 'detailed-ep-04.mkv', episode=4, date=14),
        _insert_history_row(history_db, DOWNLOADED, 'detailed-ep-05.mkv', episode=5, date=15),
    ]

    first_response = await fetch_history(
        'My English Title',
        page=1,
        limit=2,
        sort=[{'field': 'actionDate', 'type': 'desc'}],
    )
    first_rows = json.loads(first_response.body)

    second_response = await fetch_history(
        'My English Title',
        page=2,
        limit=2,
        sort=[{'field': 'actionDate', 'type': 'desc'}],
    )
    second_rows = json.loads(second_response.body)

    assert first_response.headers['X-Pagination-Count'] == '5'
    assert second_response.headers['X-Pagination-Count'] == '5'
    assert [row['id'] for row in first_rows] == [inserted[4], inserted[3]]
    assert [row['id'] for row in second_rows] == [inserted[2], inserted[1]]
