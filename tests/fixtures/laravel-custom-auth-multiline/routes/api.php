<?php

use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::prefix('api')
    ->middleware([
        'checkPermission',
    ])
    ->group(function () {
        Route::get(
            '/reports',
            [ReportController::class, 'index']
        );
    });
