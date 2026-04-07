<?php

namespace App\Http\Controllers;

class ReportController
{
    public function index()
    {
        return response()->json([
            'data' => [
                [
                    'id' => 1,
                    'name' => 'Daily report',
                ],
            ],
        ]);
    }
}
