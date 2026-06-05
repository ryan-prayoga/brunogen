<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreReportRequest;
use App\Support\ApiResponse;

class ReportController
{
    public function store(StoreReportRequest $request)
    {
        $payload = [
            'id' => 10,
            'title' => 'Quarterly report',
        ];

        return ApiResponse::created($payload);
    }
}
