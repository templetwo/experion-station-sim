# @artifact dev
"""Fast balance/analytic probes for the independent gas extension."""
import hashlib
import json
from pathlib import Path
import unittest

import numpy as np
import reference as r


class ReferenceTests(unittest.TestCase):
    def test_embedded_geometry_is_unchanged(self):
        path=r.HERE.parent/'g2-geometry/recipe.json'
        self.assertEqual(r.digest(path),r.RECIPE['geometry_basis_sha256'])
        self.assertEqual(json.loads(path.read_text()),r.B)

    def test_nominal_gas_and_reactor_balance(self):
        d=r.derivative(r.initial_state(),r.inputs(),False)
        np.testing.assert_allclose(d[:4],0,rtol=0,atol=1e-15)
        self.assertAlmostEqual(d[27],0,places=15)
        self.assertAlmostEqual(d[47],.16,places=15)
        self.assertAlmostEqual(d[103],.16,places=15)
        self.assertEqual(d[107],0)

    def test_closed_normal_vent_analytic_pressure_slope(self):
        d=r.derivative(r.initial_state(),r.inputs(gas_valve=0),False)
        self.assertAlmostEqual(d[27]/r.G['compliance_kg_per_kpa'],4.32,places=13)
        self.assertAlmostEqual(np.sum(d[:28]),np.sum(d[32:36])-sum(np.sum(d[32+4*i:36+4*i]) for i,t in enumerate(r.TRANSFERS) if t['destination'] not in r.INVENTORIES),places=12)

    def test_analytical_first_lift(self):
        result=r.simulate([r.segment(70,gas_valve=0)])
        self.assertEqual(len(result['events']),1)
        self.assertTrue(result['events'][0]['open'])
        self.assertAlmostEqual(result['events'][0]['time_s'],300/4.32,places=7)
        self.assertTrue(r.closure(result['states'])['passed'])

    def test_local_transfer_tamper_fails_even_when_global_mass_closes(self):
        y=r.initial_state();y[32+4*7+1]+=.25
        result=r.closure([y])
        self.assertFalse(result['passed'])
        self.assertEqual(result['maximum_total_residual_kg'],0)
        self.assertEqual(result['maximum_local_residual_kg'],.25)

    def test_failed_archive_reproduces_exact_receipt_hashes(self):
        archive=json.loads((r.HERE/'archives/discrete-latch-v1.json').read_text())
        receipt=json.loads((r.HERE/'receipts/discrete-latch-v1.json').read_text())
        self.assertFalse(receipt['passed'])
        for name,item in archive['sources'].items():
            actual=hashlib.sha256(item['source'].encode()).hexdigest()
            self.assertEqual(actual,item['sha256'])
            if name in receipt['source_sha256']:self.assertEqual(actual,receipt['source_sha256'][name])
        failed=receipt['cases']['closed-normal-vent-relief-cycles']
        self.assertFalse(failed['comparison']['passed'])
        self.assertTrue(all(c['passed'] for c in failed['closure'].values()))

if __name__=='__main__':unittest.main()
