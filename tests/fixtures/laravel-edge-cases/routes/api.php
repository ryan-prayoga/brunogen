<?php

use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::post('/reports', [ReportController::class, 'store']);
