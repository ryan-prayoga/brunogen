<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreUserRequest;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index()
    {
        return [
            'data' => [
                [
                    'id' => 1,
                    'name' => 'Jane Doe',
                ],
            ],
            'meta' => [
                'page' => 1,
            ],
        ];
    }

    public function store(StoreUserRequest $request)
    {
        return response()->json([
            'message' => 'User created',
            'data' => [
                'id' => 1,
                'name' => 'Jane Doe',
                'email' => 'jane@example.com',
            ],
        ], 201);
    }

    public function show(Request $request)
    {
        return [
            'data' => [
                'id' => 1,
                'name' => 'Jane Doe',
            ],
        ];
    }
}
